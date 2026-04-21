import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { Activity, Zap } from 'lucide-react';

const MAX_NODES = 10000;
const MAX_EDGES = 8000;

// Ephemeral effects (bolts, particles)
interface EphemeralEffect {
    mesh: THREE.Object3D;
    startTime: number;
    duration: number;
    update: (now: number) => boolean; // Returns true if should be removed
}

const NODE_VERTEX_SHADER = `
    attribute float lastActiveTime;
    attribute vec3 color;
    attribute vec3 offset;
    attribute float connectionCount;
    varying vec3 vColor;
    varying float vAlpha;
    uniform float uTime;
    uniform float uFadeDuration;
    uniform float uBaseOpacity;
    uniform float uMaxOpacity;
    uniform float uSize;
    uniform float uCollapse;

    void main() {
        vColor = color;
        float age = uTime - lastActiveTime;
        float fade = clamp(1.0 - (age / uFadeDuration), 0.0, 1.0);
        vAlpha = mix(uBaseOpacity, uMaxOpacity, fade);
        
        float size = (uSize + (connectionCount * 2.0)) * mix(1.0, 3.0, fade);
        
        vec3 pos = position;
        float time = uTime * 0.00005; // Ultra slow time base
        
        // Swirl / Orbital movement
        float swirlSpeed = 0.05 + (uCollapse * 0.1); 
        float angleX = time * offset.x * swirlSpeed;
        float angleY = time * offset.y * swirlSpeed;
        
        float sY = sin(angleY);
        float cY = cos(angleY);
        mat2 rotY = mat2(cY, -sY, sY, cY);
        pos.xz = rotY * pos.xz;
        
        float sX = sin(angleX);
        float cX = cos(angleX);
        mat2 rotX = mat2(cX, -sX, sX, cX);
        pos.yz = rotX * pos.yz;

        // Collapse logic (driven by normalized audio levels or inference state)
        float collapseFactor = mix(1.0, 0.3, uCollapse);
        pos *= collapseFactor;
        
        // Micro-jitter
        pos.x += sin(uTime * 0.002 + offset.z) * 1.5 * collapseFactor;
        pos.y += cos(uTime * 0.002 + offset.x) * 1.5 * collapseFactor;
        pos.z += sin(uTime * 0.002 + offset.y) * 1.5 * collapseFactor;
        
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = size * (1000.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const NODE_FRAGMENT_SHADER = `
    varying vec3 vColor;
    varying float vAlpha;

    void main() {
        vec2 coord = gl_PointCoord - vec2(0.5);
        float dist = length(coord);
        float glow = exp(-dist * 6.0); 
        float alpha = glow * vAlpha;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(vColor, alpha);
    }
`;

const EDGE_VERTEX_SHADER = `
    attribute float lastActiveTime;
    varying float vAlpha;
    varying vec3 vColor;
    attribute vec3 color;
    uniform float uTime;
    uniform float uFadeDuration;
    uniform float uCollapse;

    void main() {
        vColor = color;
        float age = uTime - lastActiveTime;
        float fade = clamp(1.0 - (age / uFadeDuration), 0.0, 1.0);
        
        float collapseFactor = mix(1.0, 0.3, uCollapse);
        vAlpha = mix(0.1, 0.6, fade) * collapseFactor;
        vec3 pos = position * collapseFactor;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
`;

const EDGE_FRAGMENT_SHADER = `
    varying float vAlpha;
    varying vec3 vColor;

    void main() {
        gl_FragColor = vec4(vColor, vAlpha);
    }
`;

interface CinematicViewProps {
    onSymbolFocus?: (name: string | null) => void;
    isSpeaking?: boolean;
    audioAnalyser?: AnalyserNode | null;
}

export const CinematicView: React.FC<CinematicViewProps> = ({ onSymbolFocus, isSpeaking = false, audioAnalyser }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);

    const nodeGeomRef = useRef<THREE.BufferGeometry | null>(null);
    const uniformsRef = useRef<any>(null);
    const edgeUniformsRef = useRef<any>(null);

    const positionsBuffer = useRef<Float32Array>(new Float32Array(MAX_NODES * 3));
    const colorsBuffer = useRef<Float32Array>(new Float32Array(MAX_NODES * 3));
    const offsetsBuffer = useRef<Float32Array>(new Float32Array(MAX_NODES * 3));
    const connectionsBuffer = useRef<Float32Array>(new Float32Array(MAX_NODES));
    const activeTimesBuffer = useRef<Float32Array>(new Float32Array(MAX_NODES));

    const edgePositions = useRef<Float32Array>(new Float32Array(MAX_EDGES * 2 * 3));
    const edgeColors = useRef<Float32Array>(new Float32Array(MAX_EDGES * 2 * 3));
    const edgeTimes = useRef<Float32Array>(new Float32Array(MAX_EDGES * 2));

    const [isLoading, setIsLoading] = useState(true);
    const [lastFastMetric, setLastFastMetric] = useState<{ durationMs: number, status: string } | null>(null);

    const symbolToIndex = useRef<Map<string, number>>(new Map());
    const nextAvailableIndex = useRef(0);
    const activeEdges = useRef<number>(0);
    const symbolConnections = useRef<Map<string, number>>(new Map());
    const ephemeralEffects = useRef<EphemeralEffect[]>([]);

    const getDomainColor = (domain: string, saturation = 0.8, lightness = 0.6) => {
        if (!domain) return new THREE.Color(0x6366f1);
        let hash = 0;
        for (let i = 0; i < domain.length; i++) hash = domain.charCodeAt(i) + ((hash << 5) - hash);
        const color = new THREE.Color();
        color.setHSL(Math.abs(hash % 360) / 360, saturation, lightness);
        return color;
    };

    const getSymbolIndex = (id: string) => {
        if (symbolToIndex.current.has(id)) return symbolToIndex.current.get(id)!;
        const idx = nextAvailableIndex.current % MAX_NODES;
        symbolToIndex.current.set(id, idx);
        nextAvailableIndex.current++;
        return idx;
    };

    const getSymbolPos = (id: string): THREE.Vector3 | null => {
        const idx = symbolToIndex.current.get(id);
        if (idx === undefined) return null;
        const collapse = uniformsRef.current?.uCollapse?.value || 0;
        const collapseFactor = 1.0 - (collapse * 0.7);
        return new THREE.Vector3(
            positionsBuffer.current[idx * 3] * collapseFactor,
            positionsBuffer.current[idx * 3 + 1] * collapseFactor,
            positionsBuffer.current[idx * 3 + 2] * collapseFactor
        );
    };

    const updateNode = (id: string, color?: THREE.Color, active: boolean = false) => {
        const idx = getSymbolIndex(id);
        if (color) {
            colorsBuffer.current[idx * 3] = color.r;
            colorsBuffer.current[idx * 3 + 1] = color.g;
            colorsBuffer.current[idx * 3 + 2] = color.b;
            if (nodeGeomRef.current) nodeGeomRef.current.attributes.color.needsUpdate = true;
        }
        if (active) {
            activeTimesBuffer.current[idx] = performance.now();
            if (nodeGeomRef.current) nodeGeomRef.current.attributes.lastActiveTime.needsUpdate = true;
        }

        const connCount = symbolConnections.current.get(id) || 0;
        connectionsBuffer.current[idx] = connCount;
        if (nodeGeomRef.current) nodeGeomRef.current.attributes.connectionCount.needsUpdate = true;
    };

    const pulseNode = (nodeId: string, color = new THREE.Color(0xffffff)) => {
        updateNode(nodeId, color, true);
        if (onSymbolFocus) onSymbolFocus(nodeId);

        setTimeout(() => {
            updateNode(nodeId, undefined, false);
        }, 2000);
    };

    const addEdge = (sourceId: string, targetId: string) => {
        const sIdx = getSymbolIndex(sourceId);
        const tIdx = getSymbolIndex(targetId);
        const eIdx = (activeEdges.current % MAX_EDGES) * 2;

        edgePositions.current.set([positionsBuffer.current[sIdx * 3], positionsBuffer.current[sIdx * 3 + 1], positionsBuffer.current[sIdx * 3 + 2]], eIdx * 3);
        edgePositions.current.set([positionsBuffer.current[tIdx * 3], positionsBuffer.current[tIdx * 3 + 1], positionsBuffer.current[tIdx * 3 + 2]], (eIdx + 1) * 3);

        const col = new THREE.Color(0x6366f1);
        edgeColors.current.set([col.r, col.g, col.b], eIdx * 3);
        edgeColors.current.set([col.r, col.g, col.b], (eIdx + 1) * 3);

        edgeTimes.current[eIdx] = performance.now();
        edgeTimes.current[eIdx + 1] = performance.now();

        symbolConnections.current.set(sourceId, (symbolConnections.current.get(sourceId) || 0) + 1);
        symbolConnections.current.set(targetId, (symbolConnections.current.get(targetId) || 0) + 1);
        updateNode(sourceId);
        updateNode(targetId);

        activeEdges.current++;
    };

    // --- EFFECT CREATORS ---

    const createLightningBolt = (start: THREE.Vector3, end: THREE.Vector3) => {
        const points: THREE.Vector3[] = [start];
        const direction = end.clone().sub(start);
        const length = direction.length();
        direction.normalize();
        const segments = 12;
        const randomness = length * 0.15;

        for (let i = 1; i < segments; i++) {
            const along = (length / segments) * i;
            const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
            const perpendicular = direction.clone().cross(axis).normalize();
            const midFactor = 1.0 - Math.abs(i - segments / 2) / (segments / 2);
            const offset = perpendicular.multiplyScalar((Math.random() - 0.5) * randomness * midFactor); 
            
            const next = start.clone().add(direction.clone().multiplyScalar(along)).add(offset);
            points.push(next);
        }
        points.push(end);
        
        const curve = new THREE.CatmullRomCurve3(points);
        const geometry = new THREE.TubeGeometry(curve, 32, 0.4, 6, false);
        const material = new THREE.MeshBasicMaterial({
            color: new THREE.Color(0x99ccff),
            blending: THREE.AdditiveBlending,
            transparent: true,
            opacity: 1.0,
            side: THREE.DoubleSide
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        sceneRef.current?.add(mesh);

        ephemeralEffects.current.push({
            mesh,
            startTime: performance.now(),
            duration: 800,
            update: (now) => {
                const alpha = Math.max(0, 1.0 - (now - mesh.userData.startTime) / 800);
                (mesh.material as THREE.MeshBasicMaterial).opacity = alpha;
                mesh.scale.setScalar(1.0 + (1.0 - alpha) * 0.5);
                return alpha <= 0;
            }
        });
        mesh.userData.startTime = performance.now();
    };

    const createExplosion = (pos: THREE.Vector3, color: THREE.Color, count = 20) => {
        const geom = new THREE.BufferGeometry();
        const posArr = new Float32Array(count * 3);
        const velArr = new Float32Array(count * 3);
        
        for(let i=0; i<count; i++) {
            posArr.set([pos.x, pos.y, pos.z], i*3);
            velArr.set([(Math.random()-0.5)*4, (Math.random()-0.5)*4, (Math.random()-0.5)*4], i*3);
        }
        
        geom.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
        const mat = new THREE.PointsMaterial({ color, size: 2, transparent: true, blending: THREE.AdditiveBlending });
        const points = new THREE.Points(geom, mat);
        sceneRef.current?.add(points);
        
        ephemeralEffects.current.push({
            mesh: points,
            startTime: performance.now(),
            duration: 1500,
            update: (now) => {
                const age = now - points.userData.startTime;
                const alpha = Math.max(0, 1.0 - age / 1500);
                (points.material as THREE.PointsMaterial).opacity = alpha;
                const p = points.geometry.attributes.position.array as Float32Array;
                for(let i=0; i<count; i++) {
                    p[i*3] += velArr[i*3];
                    p[i*3+1] += velArr[i*3+1];
                    p[i*3+2] += velArr[i*3+2];
                }
                points.geometry.attributes.position.needsUpdate = true;
                return alpha <= 0;
            }
        });
        points.userData.startTime = performance.now();
    };

    useEffect(() => {
        let isMounted = true;
        let animationFrameId: number;

        const handleResize = () => {
            if (rendererRef.current && cameraRef.current && containerRef.current) {
                const w = containerRef.current.clientWidth;
                const h = containerRef.current.clientHeight;
                rendererRef.current.setSize(w, h);
                cameraRef.current.aspect = w / h;
                cameraRef.current.updateProjectionMatrix();
                if (controlsRef.current) controlsRef.current.target.set(0, 0, 0);
            }
        };

        const initGraph = async () => {
            if (!containerRef.current || !isMounted) return;
            setIsLoading(true);
            try {
                const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
                renderer.setPixelRatio(window.devicePixelRatio);
                const w = containerRef.current.clientWidth || window.innerWidth;
                const h = containerRef.current.clientHeight || window.innerHeight;
                renderer.setSize(w, h);
                renderer.setClearColor(0x000000, 1.0);
                containerRef.current.innerHTML = '';
                containerRef.current.appendChild(renderer.domElement);
                rendererRef.current = renderer;

                const scene = new THREE.Scene();
                sceneRef.current = scene;

                const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 10000);
                camera.position.z = 600;
                cameraRef.current = camera;

                const controls = new OrbitControls(camera, renderer.domElement);
                controls.enableDamping = true;
                controlsRef.current = controls;

                for (let i = 0; i < MAX_NODES; i++) {
                    const u = Math.random() * Math.PI * 2;
                    const v = Math.random() * Math.PI;
                    const r = (150 + Math.random() * 250) * Math.pow(Math.random(), 1.0 / 3.0);
                    positionsBuffer.current[i * 3] = r * 1.5 * Math.sin(v) * Math.cos(u);
                    positionsBuffer.current[i * 3 + 1] = r * 1.2 * Math.sin(v) * Math.sin(u);
                    positionsBuffer.current[i * 3 + 2] = r * 0.9 * Math.cos(v);

                    offsetsBuffer.current[i * 3] = (Math.random() - 0.5) * 2.0;
                    offsetsBuffer.current[i * 3 + 1] = (Math.random() - 0.5) * 2.0;
                    offsetsBuffer.current[i * 3 + 2] = (Math.random() - 0.5) * 2.0;

                    const randomColor = new THREE.Color().setHSL(Math.random(), 0.4, 0.3);
                    colorsBuffer.current[i * 3] = randomColor.r;
                    colorsBuffer.current[i * 3 + 1] = randomColor.g;
                    colorsBuffer.current[i * 3 + 2] = randomColor.b;
                    connectionsBuffer.current[i] = 0;
                    activeTimesBuffer.current[i] = -9999999;
                }

                const nodeGeom = new THREE.BufferGeometry();
                nodeGeom.setAttribute('position', new THREE.BufferAttribute(positionsBuffer.current, 3));
                nodeGeom.setAttribute('color', new THREE.BufferAttribute(colorsBuffer.current, 3));
                nodeGeom.setAttribute('offset', new THREE.BufferAttribute(offsetsBuffer.current, 3));
                nodeGeom.setAttribute('connectionCount', new THREE.BufferAttribute(connectionsBuffer.current, 1));
                nodeGeom.setAttribute('lastActiveTime', new THREE.BufferAttribute(activeTimesBuffer.current, 1));
                nodeGeomRef.current = nodeGeom;

                const nodeMat = new THREE.ShaderMaterial({
                    uniforms: { uTime: { value: 0 }, uFadeDuration: { value: 3000 }, uBaseOpacity: { value: 0.8 }, uMaxOpacity: { value: 1.0 }, uSize: { value: 12.0 }, uCollapse: { value: 0.0 } },
                    vertexShader: NODE_VERTEX_SHADER, fragmentShader: NODE_FRAGMENT_SHADER, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
                });
                uniformsRef.current = nodeMat.uniforms;
                scene.add(new THREE.Points(nodeGeom, nodeMat));

                const edgeGeom = new THREE.BufferGeometry();
                edgeGeom.setAttribute('position', new THREE.BufferAttribute(edgePositions.current, 3));
                edgeGeom.setAttribute('color', new THREE.BufferAttribute(edgeColors.current, 3));
                edgeGeom.setAttribute('lastActiveTime', new THREE.BufferAttribute(edgeTimes.current, 1));

                const edgeMat = new THREE.ShaderMaterial({
                    uniforms: { uTime: { value: 0 }, uFadeDuration: { value: 3000 }, uCollapse: { value: 0.0 } },
                    vertexShader: EDGE_VERTEX_SHADER, fragmentShader: EDGE_FRAGMENT_SHADER, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
                });
                edgeUniformsRef.current = edgeMat.uniforms;
                scene.add(new THREE.LineSegments(edgeGeom, edgeMat));

                const audioData = new Uint8Array(audioAnalyser?.frequencyBinCount || 128);
                let smoothedVolume = 0;

                const animate = () => {
                    if (!isMounted) return;
                    controls.update();
                    const now = performance.now();
                    nodeMat.uniforms.uTime.value = now;
                    edgeMat.uniforms.uTime.value = now;

                    // Update effects
                    for (let i = ephemeralEffects.current.length - 1; i >= 0; i--) {
                        const fx = ephemeralEffects.current[i];
                        if (fx.update(now)) {
                            scene.remove(fx.mesh);
                            if ((fx.mesh as THREE.Mesh).geometry) (fx.mesh as THREE.Mesh).geometry.dispose();
                            if ((fx.mesh as THREE.Mesh).material) {
                                if (Array.isArray((fx.mesh as THREE.Mesh).material)) {
                                    ((fx.mesh as THREE.Mesh).material as THREE.Material[]).forEach(m => m.dispose());
                                } else {
                                    ((fx.mesh as THREE.Mesh).material as THREE.Material).dispose();
                                }
                            }
                            ephemeralEffects.current.splice(i, 1);
                        }
                    }

                    if (isSpeaking && audioAnalyser) {
                        audioAnalyser.getByteFrequencyData(audioData);
                        let sum = 0;
                        for (let i = 0; i < audioData.length; i++) sum += audioData[i];
                        const volume = sum / (audioData.length * 255);
                        smoothedVolume = smoothedVolume * 0.7 + volume * 0.3;

                        const collapseVal = Math.min(smoothedVolume * 1.2, 1.0);
                        nodeMat.uniforms.uCollapse.value = collapseVal;
                        edgeMat.uniforms.uCollapse.value = collapseVal;
                    } else {
                        nodeMat.uniforms.uCollapse.value *= 0.95;
                        edgeMat.uniforms.uCollapse.value *= 0.95;
                    }

                    scene.rotation.y += 0.0002;
                    renderer.render(scene, camera);
                    animationFrameId = requestAnimationFrame(animate);
                };
                animate();

                const domains = await window.api.listDomains();
                for (const d of domains) {
                    const symbols = await window.api.getSymbolsByDomain(d);
                    symbols.forEach((s: any, idx: number) => {
                        updateNode(s.id, getDomainColor(s.symbol_domain, 0.9, 0.7));
                        if (idx > 0 && idx % 2 === 0) addEdge(symbols[idx - 1].id, s.id);
                    });
                }

                window.addEventListener('resize', handleResize);
            } catch (err) { console.error(err); } finally { if (isMounted) setIsLoading(false); }
        };

        initGraph();

        const unbindKernel = window.api.onKernelEvent((type, data) => {
            switch(type) {
                case 'symbol:upserted':
                    window.api.getSymbolById(data.symbolId).then(s => {
                        if (s) {
                            const color = getDomainColor(s.symbol_domain);
                            pulseNode(s.id, color);
                            const pos = getSymbolPos(s.id);
                            if (pos) createExplosion(pos, color, 30);
                            
                            const nearby = Array.from(symbolToIndex.current.keys());
                            if (nearby.length > 5) {
                                for(let i=0; i<2; i++) {
                                    const target = nearby[Math.floor(Math.random() * nearby.length)];
                                    addEdge(s.id, target);
                                    const tPos = getSymbolPos(target);
                                    if(pos && tPos) createLightningBolt(pos, tPos);
                                }
                            }
                        }
                    });
                    break;

                case 'symbol:deleted':
                    pulseNode(data.id, new THREE.Color(0xff3333));
                    const delPos = getSymbolPos(data.id);
                    if (delPos) createExplosion(delPos, new THREE.Color(0x661111), 50);
                    break;

                case 'trace:logged':
                    const path = data.activation_path || [];
                    for(let i=0; i < path.length - 1; i++) {
                        const sId = path[i].symbol_id || path[i].id;
                        const tId = path[i+1].symbol_id || path[i+1].id;
                        const p1 = getSymbolPos(sId);
                        const p2 = getSymbolPos(tId);
                        if (p1 && p2) {
                            setTimeout(() => {
                                createLightningBolt(p1, p2);
                                pulseNode(tId, new THREE.Color(0x99ccff));
                            }, i * 150);
                        }
                    }
                    break;

                case 'inference:started':
                    if (uniformsRef.current) uniformsRef.current.uSize.value = 18.0;
                    break;

                case 'inference:completed':
                    if (uniformsRef.current) uniformsRef.current.uSize.value = 12.0;
                    // Spark some random nodes
                    const keys = Array.from(symbolToIndex.current.keys());
                    for(let i=0; i<5; i++) {
                        const id = keys[Math.floor(Math.random()*keys.length)];
                        const p = getSymbolPos(id);
                        if(p) createExplosion(p, new THREE.Color(0xffffff), 10);
                    }
                    break;

                case 'inference:chunk':
                    // Subtle flicker on random symbols
                    const ids = Array.from(symbolToIndex.current.keys());
                    if(ids.length > 0) {
                        const targetId = ids[Math.floor(Math.random() * ids.length)];
                        updateNode(targetId, new THREE.Color(0xffffff), true);
                        setTimeout(() => updateNode(targetId, undefined, false), 100);
                    }
                    break;

                case 'domain:created':
                    // Wave effect by flashing all nodes briefly
                    const nodes = Array.from(symbolToIndex.current.keys());
                    nodes.forEach((id, i) => {
                        setTimeout(() => updateNode(id, undefined, true), i * 0.5);
                    });
                    break;

                case 'fast-inference:started':
                    if (uniformsRef.current) uniformsRef.current.uMaxOpacity.value = 1.0;
                    // Create a subtle golden pulse on many nodes
                    const allIds = Array.from(symbolToIndex.current.keys());
                    for(let i=0; i<15; i++) {
                        const id = allIds[Math.floor(Math.random() * allIds.length)];
                        updateNode(id, new THREE.Color(0xffcc33), true);
                    }
                    break;

                case 'fast-inference:completed':
                    setLastFastMetric({ durationMs: data.durationMs, status: data.status });
                    setTimeout(() => setLastFastMetric(null), 5000);

                    if (data.status === 'success') {
                        // Golden explosion at a random active node or center
                        const activeIds = Array.from(symbolToIndex.current.keys());
                        const randomId = activeIds[Math.floor(Math.random() * activeIds.length)];
                        const p = getSymbolPos(randomId) || new THREE.Vector3(0,0,0);
                        createExplosion(p, new THREE.Color(0xffaa00), 60);
                        
                        // Link some nodes with golden bolts
                        for(let i=0; i<3; i++) {
                            const t1 = activeIds[Math.floor(Math.random() * activeIds.length)];
                            const t2 = activeIds[Math.floor(Math.random() * activeIds.length)];
                            const p1 = getSymbolPos(t1);
                            const p2 = getSymbolPos(t2);
                            if(p1 && p2) createLightningBolt(p1, p2);
                        }
                    } else {
                        // Red flicker for error
                        const keys = Array.from(symbolToIndex.current.keys());
                        for(let i=0; i<20; i++) {
                            const id = keys[Math.floor(Math.random() * keys.length)];
                            updateNode(id, new THREE.Color(0xff3300), true);
                        }
                    }
                    break;
            }
        });

        return () => {
            isMounted = false;
            cancelAnimationFrame(animationFrameId);
            window.removeEventListener('resize', handleResize);
            if (rendererRef.current) rendererRef.current.dispose();
            if (unbindKernel) unbindKernel();
            ephemeralEffects.current.forEach(fx => {
                if ((fx.mesh as THREE.Mesh).geometry) (fx.mesh as THREE.Mesh).geometry.dispose();
            });
        };
    }, [isSpeaking, audioAnalyser]);

    return (
        <div className="h-full w-full relative bg-black">
            <div ref={containerRef} className="absolute inset-0" />
            {isLoading && <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20"><Activity className="text-emerald-500 animate-spin" size={48} /></div>}
            
            {/* Fast Inference Overlay */}
            {lastFastMetric && (
                <div className="absolute top-8 left-8 z-30 p-3 bg-black/60 border border-amber-500/30 rounded-lg backdrop-blur-md animate-in slide-in-from-left-4 duration-500">
                    <div className="flex items-center gap-3">
                        <div className={`p-1.5 rounded-full ${lastFastMetric.status === 'success' ? 'bg-amber-500/20 text-amber-500' : 'bg-red-500/20 text-red-500'}`}>
                            <Zap size={14} className={lastFastMetric.status === 'success' ? 'animate-pulse' : ''} />
                        </div>
                        <div>
                            <p className="text-[10px] font-mono uppercase tracking-widest text-gray-400">Edge_Inference_Latency</p>
                            <p className="text-sm font-bold font-mono text-white">
                                {lastFastMetric.durationMs.toFixed(0)}<span className="text-[10px] text-gray-500 ml-1">MS</span>
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
