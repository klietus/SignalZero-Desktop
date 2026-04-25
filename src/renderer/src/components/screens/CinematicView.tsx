import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { Activity } from 'lucide-react';

const MAX_NODES = 10000;
const MAX_EDGES = 8000;

// GPU-accelerated ephemeral effects buffer system for performance at 5000+ nodes
interface EphemeralEffect {
    mesh: THREE.Object3D;
    startTime: number;
    duration: number;
    update: (now: number) => boolean;
}

// Instanced particle pool for zero-allocation effects
class ParticlePool {
    private maxParticles: number;
    private geometry: THREE.BufferGeometry | null = null;
    private material: THREE.PointsMaterial | null = null;
    private mesh: THREE.Points | null = null;
    private activeCount: number = 0;
    private positions: Float32Array;
    private colors: Float32Array;
    private sizes: Float32Array;
    private lifetimes: Float32Array;
    private velocities: Float32Array;

    constructor(maxParticles: number) {
        this.maxParticles = maxParticles;
        this.positions = new Float32Array(maxParticles * 3);
        this.colors = new Float32Array(maxParticles * 3);
        this.sizes = new Float32Array(maxParticles);
        this.lifetimes = new Float32Array(maxParticles);
        this.velocities = new Float32Array(maxParticles * 3);
    }

    init(scene: THREE.Scene) {
        if (this.geometry) return;

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        geom.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
        geom.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
        geom.setAttribute('lifetime', new THREE.BufferAttribute(this.lifetimes, 1));

        const mat = new THREE.PointsMaterial({
            size: 2,
            vertexColors: true,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.geometry = geom;
        this.material = mat;
        this.mesh = new THREE.Points(geom, mat);
        scene.add(this.mesh);
    }

    spawn(pos: THREE.Vector3, color: THREE.Color, count: number, speed: number = 1) {
        if (!this.mesh || !this.geometry) return;

        for (let i = 0; i < count && this.activeCount < this.maxParticles; i++) {
            const idx = this.activeCount % this.maxParticles;
            const baseIdx = idx * 3;

            this.positions[baseIdx] = pos.x;
            this.positions[baseIdx + 1] = pos.y;
            this.positions[baseIdx + 2] = pos.z;

            this.colors[baseIdx] = color.r;
            this.colors[baseIdx + 1] = color.g;
            this.colors[baseIdx + 2] = color.b;

            this.sizes[idx] = Math.random() * 3 + 1;
            this.lifetimes[idx] = performance.now();

            const angle = Math.random() * Math.PI * 2;
            const spread = (Math.random() - 0.5) * Math.PI;
            const vel = speed * Math.random();

            this.velocities[baseIdx] = Math.cos(angle) * Math.cos(spread) * vel;
            this.velocities[baseIdx + 1] = Math.sin(angle) * Math.cos(spread) * vel;
            this.velocities[baseIdx + 2] = Math.sin(spread) * vel;

            this.activeCount++;
        }

        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;
    }

    update(now: number): void {
        if (!this.mesh || !this.geometry || this.activeCount === 0) return;

        const lifespan = 1500;
        let needsUpdate = false;

        for (let i = 0; i < this.maxParticles; i++) {
            const age = now - this.lifetimes[i];
            if (age > lifespan) continue;

            const baseIdx = i * 3;
            
            // Update position
            this.positions[baseIdx] += this.velocities[baseIdx];
            this.positions[baseIdx + 1] += this.velocities[baseIdx + 1];
            this.positions[baseIdx + 2] += this.velocities[baseIdx + 2];

            // Fade size
            const alpha = 1.0 - (age / lifespan);
            this.sizes[i] *= alpha;

            needsUpdate = true;
        }

        if (needsUpdate) {
            this.geometry.attributes.position.needsUpdate = true;
            this.geometry.attributes.size.needsUpdate = true;
        }
    }

    dispose() {
        if (this.mesh) {
            this.mesh.geometry.dispose();
            if (this.material) this.material.dispose();
        }
    }
}

// Shockwave effect using ring geometry reuse
class ShockwavePool {
    private maxShockwaves: number;
    private meshes: THREE.Mesh[] = [];
    private activeIndices: Set<number> = new Set();

    constructor(maxShockwaves: number) {
        this.maxShockwaves = maxShockwaves;
        const geom = new THREE.RingGeometry(0.5, 0.8, 32);
        const mat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.5,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        for (let i = 0; i < maxShockwaves; i++) {
            const mesh = new THREE.Mesh(geom.clone(), mat.clone());
            mesh.visible = false;
            this.meshes.push(mesh);
        }
    }

    init(scene: THREE.Scene) {
        this.meshes.forEach(m => scene.add(m));
    }

    spawn(pos: THREE.Vector3, color: THREE.Color) {
        const idx = this.activeIndices.size > 0 
            ? Math.min(...Array.from(this.activeIndices))
            : this.meshes.findIndex(m => !m.visible);

        if (idx === -1 || idx >= this.maxShockwaves) return;

        const mesh = this.meshes[idx];
        mesh.position.copy(pos);
        mesh.material.color.copy(color);
        mesh.scale.set(0.1, 0.1, 0.1);
        mesh.visible = true;
        mesh.userData.startTime = performance.now();
        mesh.userData.expansionRate = 0.02 + Math.random() * 0.01;

        this.activeIndices.add(idx);
    }

    update(now: number): void {
        for (const idx of this.activeIndices) {
            const mesh = this.meshes[idx];
            if (!mesh.visible) continue;

            const age = now - mesh.userData.startTime;
            const alpha = 1.0 - (age / 800);

            if (alpha <= 0) {
                mesh.visible = false;
                this.activeIndices.delete(idx);
                continue;
            }

            mesh.scale.multiplyScalar(1 + mesh.userData.expansionRate);
            (mesh.material as THREE.MeshBasicMaterial).opacity = alpha * 0.5;
        }
    }

    dispose() {
        this.meshes.forEach(m => {
            m.geometry.dispose();
            (m.material as THREE.Material).dispose();
        });
    }
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

    const symbolToIndex = useRef<Map<string, number>>(new Map());
    const nextAvailableIndex = useRef(0);
    const activeEdges = useRef<number>(0);
    const symbolConnections = useRef<Map<string, number>>(new Map());
    const ephemeralEffects = useRef<EphemeralEffect[]>([]);
    const particlePool = useRef<ParticlePool | null>(null);
    const shockwavePool = useRef<ShockwavePool | null>(null);

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
                return alpha <= 0;
            }
        });
        mesh.userData.startTime = performance.now();
    };

    const createExplosion = (pos: THREE.Vector3, color: THREE.Color, count = 20, speed: number = 1) => {
        particlePool.current?.spawn(pos, color, Math.min(count, 50), speed);
    };

    const createShockwave = (pos: THREE.Vector3, color: THREE.Color) => {
        shockwavePool.current?.spawn(pos, color);
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

                // Initialize pooled effects
                particlePool.current = new ParticlePool(500);
                particlePool.current.init(scene);
                
                shockwavePool.current = new ShockwavePool(50);
                shockwavePool.current.init(scene);

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

                    // Update pooled effects (zero allocation)
                    particlePool.current?.update(now);
                    shockwavePool.current?.update(now);

                    // Audio-based graph contraction (AI speaking visualization)
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

                case 'context:created':
                    // New session - create a ring of activation around center
                    const sessionIds = Array.from(symbolToIndex.current.keys());
                    for(let i=0; i<10; i++) {
                        const id = sessionIds[Math.floor(Math.random() * sessionIds.length)];
                        const pos = getSymbolPos(id);
                        if(pos) createShockwave(pos, new THREE.Color(0x66ccff));
                    }
                    break;

                case 'context:closed':
                    // Session ended - subtle fade effect
                    const closedIds = Array.from(symbolToIndex.current.keys());
                    for(let i=0; i<15; i++) {
                        setTimeout(() => {
                            const id = closedIds[Math.floor(Math.random() * closedIds.length)];
                            updateNode(id, new THREE.Color(0x444444), true);
                        }, i * 30);
                    }
                    break;

                case 'cache:load':
                    // Cache hit - golden shimmer on loaded symbols
                    if (data.symbolIds && data.symbolIds.length > 0) {
                        data.symbolIds.forEach((id: string, idx: number) => {
                            setTimeout(() => {
                                const pos = getSymbolPos(id);
                                if(pos) createExplosion(pos, new THREE.Color(0xffdd44), 15, 0.5);
                            }, idx * 20);
                        });
                    }
                    break;

                case 'symbol:compression':
                    // Symbols merged - collapse effect with golden pulse
                    const canonicalPos = getSymbolPos(data.canonicalId);
                    if(canonicalPos) {
                        createShockwave(canonicalPos, new THREE.Color(0xffaa22));
                        updateNode(data.canonicalId, new THREE.Color(0xffdd44), true);
                    }
                    break;

                case 'orphan:detected':
                    // Orphan detected - red pulse with isolation effect
                    const orphanPos = getSymbolPos(data.symbolId);
                    if(orphanPos) {
                        createExplosion(orphanPos, new THREE.Color(0xff4422), 30);
                        updateNode(data.symbolId, new THREE.Color(0xff2222), true);
                    }
                    break;

                case 'tentative:create':
                    // Tentative link created - subtle purple bolt
                    const tPos1 = getSymbolPos(data.sourceId);
                    const tPos2 = getSymbolPos(data.targetId);
                    if(tPos1 && tPos2) {
                        createLightningBolt(tPos1, tPos2);
                        // Flash both endpoints
                        updateNode(data.sourceId, new THREE.Color(0xaa66ff), true);
                        updateNode(data.targetId, new THREE.Color(0xaa66ff), true);
                    }
                    break;

                case 'tentative:delete':
                    // Tentative link removed - fading effect
                    const dPos1 = getSymbolPos(data.sourceId);
                    const dPos2 = getSymbolPos(data.targetId);
                    if(dPos1) createExplosion(dPos1, new THREE.Color(0x664488), 10);
                    if(dPos2) createExplosion(dPos2, new THREE.Color(0x664488), 10);
                    break;

                case 'inference:error':
                    // Error - red shockwave from center
                    createShockwave(new THREE.Vector3(0,0,0), new THREE.Color(0xff2222));
                    // Flash random nodes red
                    const errorIds = Array.from(symbolToIndex.current.keys());
                    for(let i=0; i<10; i++) {
                        const id = errorIds[Math.floor(Math.random() * errorIds.length)];
                        updateNode(id, new THREE.Color(0xff1111), true);
                    }
                    break;

                case 'agent:heartbeat':
                    // Agent activity - subtle green pulse
                    if(data.status === 'running') {
                        const agentIds = Array.from(symbolToIndex.current.keys());
                        for(let i=0; i<5; i++) {
                            const id = agentIds[Math.floor(Math.random() * agentIds.length)];
                            updateNode(id, new THREE.Color(0x44ff44), true);
                        }
                    }
                    break;

                case 'project:import-status':
                    if(data.status === 'completed' && data.stats) {
                        // Import complete - massive celebration effect
                        const keys = Array.from(symbolToIndex.current.keys());
                        for(let i=0; i<50; i++) {
                            setTimeout(() => {
                                const id = keys[Math.floor(Math.random() * keys.length)];
                                const pos = getSymbolPos(id);
                                if(pos) createExplosion(pos, new THREE.Color(0xffaa44), 20);
                            }, i * 30);
                        }
                    } else if (data.error) {
                        // Import error - red cascade
                        createShockwave(new THREE.Vector3(0,0,0), new THREE.Color(0xff0000));
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
            particlePool.current?.dispose();
            shockwavePool.current?.dispose();
        };
    }, [isSpeaking, audioAnalyser]);

    return (
        <div className="h-full w-full relative bg-black">
            <div ref={containerRef} className="absolute inset-0" />
            
            {isLoading && <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20"><Activity className="text-emerald-500 animate-spin" size={48} /></div>}
        </div>
    );
};
