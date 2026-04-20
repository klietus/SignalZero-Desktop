
import React, { useEffect, useRef, useState } from 'react';
// @ts-ignore
import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';
// @ts-ignore
import SpriteText from 'three-spritetext';
import { SymbolDef } from '../../types';
import { Activity } from 'lucide-react';

interface GraphNode {
    id: string;
    name: string;
    domain: string;
    val: number;
    color: string;
    isCached: boolean;
    kind?: string;
    x?: number;
    y?: number;
    z?: number;
}

interface GraphLink {
    source: string;
    target: string;
    color?: string;
    width?: number;
}

interface CinematicViewProps {
    onSymbolFocus?: (name: string | null) => void;
}

export const CinematicView: React.FC<CinematicViewProps> = ({ onSymbolFocus }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const graphRef = useRef<any>(null);
    const alive = useRef(true);
    const [isLoading, setIsLoading] = useState(true);
    const eventQueue = useRef<any[]>([]);
    const lastEventTime = useRef<number>(Date.now());
    const graphData = useRef<{ nodes: GraphNode[], links: GraphLink[] }>({ nodes: [], links: [] });
    
    // Track symbols per session: sessionId -> Map<symbolId, SymbolDef>
    const sessionCaches = useRef<Map<string, Map<string, SymbolDef>>>(new Map());

    // WebGL Check
    const isWebglSupported = () => {
        try {
            const canvas = document.createElement('canvas');
            return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
        } catch (e) {
            return false;
        }
    };

    const getDomainColor = (domain: string) => {
        const hash = domain.split('').reduce((acc, char) => char.charCodeAt(0) + acc, 0);
        return `hsl(${hash % 360}, 70%, 60%)`;
    };

    // Initial Load - Removed full graph load. Now driven purely by events.
    useEffect(() => {
        let isMounted = true;
        let resizeObserver: ResizeObserver | null = null;

        const handleResize = () => {
            if (graphRef.current && containerRef.current) {
                graphRef.current.width(containerRef.current.clientWidth);
                graphRef.current.height(containerRef.current.clientHeight);
            }
        };

        const initGraph = async () => {
            if (!containerRef.current) return;
            if (!isWebglSupported()) {
                setIsLoading(false);
                return;
            }

            setIsLoading(true);
            await new Promise(resolve => setTimeout(resolve, 500));
            if (!isMounted) return;

            try {
                if (containerRef.current && !graphRef.current) {
                    containerRef.current.innerHTML = '';

                    graphRef.current = (ForceGraph3D as any)()(containerRef.current)
                        .graphData(graphData.current)
                        .nodeLabel((node: any) => `
                            <div class="symbol-tooltip">
                                <div class="tooltip-domain">${node.domain}</div>
                                <div class="tooltip-id">${node.id}</div>
                                <div class="tooltip-name">${node.name}</div>
                            </div>
                        `)
                        .nodeThreeObject((node: any) => {
                            // "Point of Light" style - Small sphere with high emissivity
                            const size = 1.5;
                            const geometry = new THREE.SphereGeometry(size, 8, 8);
                            const color = new THREE.Color(node.color);
                            const material = new THREE.MeshBasicMaterial({
                                color: color,
                                transparent: false
                            });
                            const mesh = new THREE.Mesh(geometry, material);
                            
                            // Add a subtle glow point
                            const spriteMaterial = new THREE.SpriteMaterial({
                                map: generateGlowTexture(node.color),
                                color: color,
                                transparent: true,
                                blending: THREE.AdditiveBlending,
                                opacity: 0.8
                            });
                            const sprite = new THREE.Sprite(spriteMaterial);
                            sprite.scale.set(size * 10, size * 10, 1);
                            
                            const group = new THREE.Group();
                            group.add(mesh);
                            group.add(sprite);
                            return group;
                        })
                        .linkThreeObject((_link: any) => {
                            // Simple line geometry for performance
                            const geometry = new THREE.BufferGeometry();
                            const material = new THREE.LineBasicMaterial({
                                color: 0x444444,
                                transparent: true,
                                opacity: 0.3
                            });
                            return new THREE.Line(geometry, material);
                        })
                        .linkPositionUpdate((mode: any, { start, end }: any) => {
                            if (mode.type === 'Line') {
                                const positions = new Float32Array([
                                    start.x, start.y, start.z,
                                    end.x, end.y, end.z
                                ]);
                                mode.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                                mode.geometry.computeBoundingSphere();
                                return true;
                            }
                            return false;
                        })
                        .linkCurvature(0) // Faster rendering without curves
                        .linkDirectionalParticles(0) // Disabled for performance as requested
                        .backgroundColor('rgba(0,0,0,0)')
                        .showNavInfo(false);

                    window.addEventListener('resize', handleResize);
                    if (containerRef.current) {
                        resizeObserver = new ResizeObserver(() => handleResize());
                        resizeObserver.observe(containerRef.current);
                    }

                    const animate = () => {
                        if (!graphRef.current) return;
                        const time = Date.now();
                        const timeSeconds = time * 0.001;
                        const camera = graphRef.current.camera();
                        const controls = graphRef.current.controls();
                        const isIdle = (time - lastEventTime.current) > 5000;

                        if (camera && controls && isIdle) {
                            const angle = 0.0003;
                            const x = camera.position.x;
                            const z = camera.position.z;
                            camera.position.x = x * Math.cos(angle) - z * Math.sin(angle);
                            camera.position.z = x * Math.sin(angle) + z * Math.cos(angle);
                            camera.position.y += Math.sin(timeSeconds * 0.4) * 0.2;
                            camera.lookAt(0, 0, 0);
                            controls.target.set(0, 0, 0);
                        }
                        requestAnimationFrame(animate);
                    };
                    animate();
                }
            } catch (err: any) {
                console.error("Graph init error", err);
            } finally {
                if (isMounted) setIsLoading(false);
            }
        };

        initGraph();

        const unbindKernel = window.api.onKernelEvent((type, data) => {
            eventQueue.current.push({ type, data });
        });

        const unbindTrace = window.api.onTraceLogged((trace) => {
            eventQueue.current.push({ type: 'trace:visualize', data: trace });
        });

        return () => {
            alive.current = false;
            isMounted = false;
            window.removeEventListener('resize', handleResize);
            if (resizeObserver) resizeObserver.disconnect();
            if (typeof unbindKernel === 'function') unbindKernel();
            if (typeof unbindTrace === 'function') unbindTrace();
            if (graphRef.current) {
                if (graphRef.current._destructor) graphRef.current._destructor();
                graphRef.current = null;
            }
        };
    }, []);

    // Helper to generate a glow sprite texture
    const generateGlowTexture = (colorStr: string) => {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.2, colorStr);
        gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 64, 64);

        const texture = new THREE.Texture(canvas);
        texture.needsUpdate = true;
        return texture;
    };

    useEffect(() => {
        const processNextEvent = async () => {
            if (eventQueue.current.length === 0) {
                setTimeout(processNextEvent, 500);
                return;
            }
            const event = eventQueue.current.shift();
            await handleVisualEvent(event);
            const baseDelay = 1000;
            const delay = Math.max(50, baseDelay / Math.log2(eventQueue.current.length + 2));
            setTimeout(processNextEvent, delay);
        };
        processNextEvent();
    }, []);

    const createParticleBurst = (x: number, y: number, z: number, color: string, intensity: 'normal' | 'high' = 'normal') => {
        if (!graphRef.current) return;
        const scene = graphRef.current.scene();
        const count = intensity === 'high' ? 80 : 15; // Reduced particle count
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const velocities: THREE.Vector3[] = [];
        for (let i = 0; i < count; i++) {
            positions[i * 3] = x;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = z;
            const speed = intensity === 'high' ? 3 : 1.5;
            velocities.push(new THREE.Vector3((Math.random() - 0.5) * speed, (Math.random() - 0.5) * speed, (Math.random() - 0.5) * speed));
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const material = new THREE.PointsMaterial({ color: new THREE.Color(color), size: 1.0, transparent: true, opacity: 1, blending: THREE.AdditiveBlending });
        const points = new THREE.Points(geometry, material);
        scene.add(points);
        let opacity = 1;
        const animateBurst = () => {
            if (opacity <= 0) { scene.remove(points); geometry.dispose(); material.dispose(); return; }
            const pos = geometry.attributes.position.array as Float32Array;
            for (let i = 0; i < count; i++) {
                pos[i * 3] += velocities[i].x; pos[i * 3 + 1] += velocities[i].y; pos[i * 3 + 2] += velocities[i].z;
            }
            geometry.attributes.position.needsUpdate = true;
            opacity -= 0.02; material.opacity = opacity;
            requestAnimationFrame(animateBurst);
        };
        animateBurst();
    };

    const pulseNode = async (nodeId: string, skipCameraMove = false) => {
        if (!alive.current) return;
        const node = graphData.current.nodes.find(n => n.id === nodeId);
        if (node && graphRef.current) {
             // const scene = graphRef.current.scene();
            if (onSymbolFocus) onSymbolFocus(node.name || node.id);
            if (!skipCameraMove && alive.current) {
                const distance = 120;
                const nodeX = node.x || 0; const nodeY = node.y || 0; const nodeZ = node.z || 0;
                const distRatio = 1 + distance / (Math.hypot(nodeX, nodeY, nodeZ) || 1);
                graphRef.current.cameraPosition({ x: nodeX * distRatio, y: nodeY * distRatio, z: nodeZ * distRatio }, node, 2000);
            }
            createParticleBurst(node.x || 0, node.y || 0, node.z || 0, node.color);
        }
    };

    const refreshGraphFromCaches = () => {
        if (!graphRef.current) return;

        // 1. Compute Union of all symbols across all session caches
        const unionMap = new Map<string, SymbolDef>();
        sessionCaches.current.forEach(sessionMap => {
            sessionMap.forEach((symbol, id) => {
                unionMap.set(id, symbol);
            });
        });

        const unionSymbols = Array.from(unionMap.values());
        const unionIds = new Set(unionSymbols.map(s => s.id));

        // 2. Update Nodes
        // Remove nodes no longer in any cache
        graphData.current.nodes = graphData.current.nodes.filter(n => unionIds.has(n.id));

        // Add/Update nodes
        unionSymbols.forEach(s => {
            if (!graphData.current.nodes.find(n => n.id === s.id)) {
                graphData.current.nodes.push({ 
                    id: s.id, 
                    name: s.name, 
                    domain: s.symbol_domain, 
                    val: 5, 
                    color: getDomainColor(s.symbol_domain), 
                    isCached: true, 
                    kind: s.kind 
                });
            }
        });

        // 3. Update Links
        const newLinks: GraphLink[] = [];
        unionSymbols.forEach(s => {
            if (s.linked_patterns) {
                s.linked_patterns.forEach((link: any) => {
                    const targetId = typeof link === 'string' ? link : link.id;
                    if (unionIds.has(targetId)) {
                        // Avoid duplicates
                        const linkExists = newLinks.some(l => 
                            (l.source === s.id && l.target === targetId) || 
                            (l.source === targetId && l.target === s.id)
                        );
                        if (!linkExists) {
                            newLinks.push({ source: s.id, target: targetId });
                        }
                    }
                });
            }
        });

        graphData.current.links = newLinks;
        graphRef.current.graphData(graphData.current);
    };

    const handleVisualEvent = async (event: any) => {
        const { type, data } = event;
        lastEventTime.current = Date.now();
        switch (type) {
            case 'symbol:upserted': {
                const s = await window.api.getSymbolById(data.symbolId);
                if (s && s.kind !== 'data') {
                    // Update the "global" view for immediate feedback
                    const existingNode = graphData.current.nodes.find(n => n.id === s.id);
                    if (!existingNode) {
                        graphData.current.nodes.push({ id: s.id, name: s.name, domain: s.symbol_domain, val: 5, color: getDomainColor(s.symbol_domain), isCached: true, kind: s.kind });
                    }
                    graphRef.current?.graphData(graphData.current);
                }
                break;
            }
            case 'cache:load': {
                const sessionId = data.sessionId;
                const symbols = data.symbols || [];
                const filteredSymbols = symbols.filter((s: any) => s.kind !== 'data');
                
                // Update specific session cache
                const sessionMap = new Map<string, SymbolDef>();
                filteredSymbols.forEach((s: SymbolDef) => sessionMap.set(s.id, s));
                sessionCaches.current.set(sessionId, sessionMap);
                
                refreshGraphFromCaches();
                break;
            }
            case 'symbol:deleted': {
                const id = data.symbolId;
                const sessionId = data.sessionId;
                
                if (data.isEviction && sessionId) {
                    // Surgical eviction from a specific session
                    const sessionMap = sessionCaches.current.get(sessionId);
                    if (sessionMap) {
                        sessionMap.delete(id);
                        refreshGraphFromCaches();
                    }
                } else {
                    // Hard delete - remove from everywhere
                    sessionCaches.current.forEach(map => map.delete(id));
                    refreshGraphFromCaches();
                }
                break;
            }
            case 'trace:visualize': {
                // Focus on nodes in trace path
                if (data.activation_path && data.activation_path.length > 0) {
                    const firstStep = data.activation_path[0];
                    const sId = firstStep.symbol_id || firstStep.id;
                    if (sId) await pulseNode(sId);
                }
                break;
            }
        }
    };

    return (
        <div className="h-full w-full relative flex flex-col font-mono text-white overflow-hidden bg-black">
            <div className="flex-1 w-full relative">
                <div ref={containerRef} className="absolute inset-0 z-10" />
                {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
                        <Activity className="text-emerald-500 animate-spin" size={48} />
                    </div>
                )}
            </div>
            <style>{`
                .symbol-tooltip { background: rgba(0, 0, 0, 0.85); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 8px; padding: 8px 12px; color: white; }
                .tooltip-domain { font-size: 9px; text-transform: uppercase; opacity: 0.5; }
                .tooltip-id { font-size: 12px; font-weight: bold; color: #00f0ff; }
                .tooltip-name { font-size: 11px; }
            `}</style>
        </div>
    );
};
