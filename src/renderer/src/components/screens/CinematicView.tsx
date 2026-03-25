
import React, { useEffect, useRef, useState } from 'react';
// @ts-ignore
import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';
// @ts-ignore
import SpriteText from 'three-spritetext';
import { SymbolDef } from '../../types';
import { Activity, X } from 'lucide-react';

interface GraphNode {
    id: string;
    name: string;
    domain: string;
    val: number;
    color: string;
    isCached: boolean;
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

export const CinematicView: React.FC = () => {
    const containerRef = useRef<HTMLDivElement>(null);
    const graphRef = useRef<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [stats, setStats] = useState({ nodes: 0, links: 0 });
    const [transientMessage, setTransientMessage] = useState<{ text: string, type?: string } | null>(null);
    const eventQueue = useRef<any[]>([]);
    const lastEventTime = useRef<number>(Date.now());
    const graphData = useRef<{ nodes: GraphNode[], links: GraphLink[] }>({ nodes: [], links: [] });

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

    const calculateNodeSize = (nodeId: string, isCached: boolean) => {
        const linkCount = graphData.current.links.filter(l => {
            const s = typeof l.source === 'string' ? l.source : (l.source as any).id;
            const t = typeof l.target === 'string' ? l.target : (l.target as any).id;
            return s === nodeId || t === nodeId;
        }).length;
        
        const baseSize = isCached ? 6 : 3;
        return baseSize + (Math.log10(linkCount + 1) * 8);
    };

    // Initial Load
    useEffect(() => {
        let isMounted = true;
        
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
                // In Desktop, we fetch everything from SQLite via IPC
                const domains = await window.api.listDomains();
                const nodeMap = new Map<string, GraphNode>();
                const tempLinks: { source: string, target: string }[] = [];

                for (const domainId of domains) {
                    const symbols = await window.api.getSymbolsByDomain(domainId);
                    if (symbols && isMounted) {
                        symbols.forEach((s: SymbolDef) => {
                            if (!nodeMap.has(s.id)) {
                                nodeMap.set(s.id, {
                                    id: s.id,
                                    name: s.name,
                                    domain: domainId,
                                    val: 3,
                                    color: getDomainColor(domainId),
                                    isCached: false
                                });
                            }

                            if (s.linked_patterns) {
                                s.linked_patterns.forEach(link => {
                                    const targetId = typeof link === 'string' ? link : link.id;
                                    tempLinks.push({ source: s.id, target: targetId });
                                });
                            }
                        });
                    }
                }

                if (!isMounted) return;

                const nodes = Array.from(nodeMap.values());
                const links = tempLinks.filter(l => nodeMap.has(l.target));

                graphData.current = { nodes, links };
                nodes.forEach(node => {
                    node.val = calculateNodeSize(node.id, node.isCached);
                });

                setStats({ nodes: nodes.length, links: links.length });

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
                            const group = new THREE.Group();
                            const size = node.val || 3;
                            
                            // Core Sphere
                            const geometry = new THREE.SphereGeometry(size, 16, 16);
                            const color = new THREE.Color(node.color);
                            const material = new THREE.MeshStandardMaterial({
                                color: color,
                                transparent: true,
                                opacity: node.isCached ? 1 : 0.7,
                                emissive: color,
                                emissiveIntensity: node.isCached ? 2 : 0.5,
                                roughness: 0.2,
                                metalness: 0.1
                            });
                            const core = new THREE.Mesh(geometry, material);
                            group.add(core);

                            // Gaussian Glow Layer (Only for cached)
                            if (node.isCached) {
                                const glowGeom = new THREE.SphereGeometry(size * 2.2, 16, 16);
                                const glowMat = new THREE.MeshBasicMaterial({
                                    color: color,
                                    transparent: true,
                                    opacity: 0.15,
                                    blending: THREE.AdditiveBlending,
                                    side: THREE.BackSide
                                });
                                const glow = new THREE.Mesh(glowGeom, glowMat);
                                glow.name = 'glow';
                                group.add(glow);
                            }
                            
                            group.userData = { isCached: node.isCached, baseEmissive: node.isCached ? 2 : 0.5 };
                            return group;
                        })
                        .linkWidth((link: any) => {
                            const sNode = typeof link.source === 'object' ? link.source : graphData.current.nodes.find(n => n.id === link.source);
                            const tNode = typeof link.target === 'object' ? link.target : graphData.current.nodes.find(n => n.id === link.target);
                            const baseWidth = link.width || 1;
                            if (sNode && tNode) {
                                const avgSize = ((sNode.val || 2) + (tNode.val || 2)) / 2;
                                return baseWidth * (avgSize / 8); 
                            }
                            return baseWidth;
                        })
                        .linkOpacity((link: any) => {
                            const sNode = typeof link.source === 'object' ? link.source : graphData.current.nodes.find(n => n.id === link.source);
                            const tNode = typeof link.target === 'object' ? link.target : graphData.current.nodes.find(n => n.id === link.target);
                            if (sNode && tNode) {
                                const avgSize = ((sNode.val || 2) + (tNode.val || 2)) / 2;
                                return Math.min(0.5, 0.1 + (avgSize / 60));
                            }
                            return 0.15;
                        })
                        .linkColor((link: any) => {
                            const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
                            const node = graphData.current.nodes.find(n => n.id === sourceId);
                            return node ? node.color : '#444444';
                        })
                        .backgroundColor('rgba(0,0,0,0)')
                        .showNavInfo(false);

                    window.addEventListener('resize', handleResize);

                    const animate = () => {
                        if (!graphRef.current) return;
                        
                        const time = Date.now();
                        const timeSeconds = time * 0.002;
                        const pulse = (Math.sin(timeSeconds) + 1) * 0.5;
                        
                        const camera = graphRef.current.camera();
                        const controls = graphRef.current.controls();
                        const isIdle = (time - lastEventTime.current) > 10000;

                        if (camera && controls && isIdle) {
                            const angle = 0.0005;
                            const x = camera.position.x;
                            const z = camera.position.z;
                            camera.position.x = x * Math.cos(angle) - z * Math.sin(angle);
                            camera.position.z = x * Math.sin(angle) + z * Math.cos(angle);
                            
                            const targetDist = 1600;
                            const currentDist = Math.hypot(camera.position.x, camera.position.y, camera.position.z);
                            const distDiff = targetDist - currentDist;
                            if (Math.abs(distDiff) > 1) {
                                const zoomStep = distDiff * 0.002;
                                const ratio = (currentDist + zoomStep) / currentDist;
                                camera.position.x *= ratio;
                                camera.position.y *= ratio;
                                camera.position.z *= ratio;
                            }
                            camera.lookAt(0, 0, 0);
                            controls.target.set(0, 0, 0);
                        }

                        graphRef.current.scene().traverse((obj: any) => {
                            if (obj.type === 'Group' && obj.userData && obj.userData.isCached) {
                                const core = obj.children[0];
                                if (core && core.material) {
                                    core.material.emissiveIntensity = obj.userData.baseEmissive + (pulse * 1.5);
                                    const scale = 1 + (pulse * 0.1);
                                    obj.scale.set(scale, scale, scale);
                                }
                            }
                        });
                        
                        requestAnimationFrame(animate);
                    };
                    animate();

                    const scene = graphRef.current.scene();
                    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
                }
            } catch (err: any) {
                console.error("Graph init error", err);
            } finally {
                if (isMounted) setIsLoading(false);
            }
        };

        initGraph();

        // Subscribe to Desktop Kernel Events
        window.api.onKernelEvent((type, data) => {
            eventQueue.current.push({ type, data });
        });

        return () => {
            isMounted = false;
            window.removeEventListener('resize', handleResize);
            if (graphRef.current) {
                if (graphRef.current._destructor) graphRef.current._destructor();
                graphRef.current = null;
            }
        };
    }, []);

    // Event Processor
    useEffect(() => {
        const processNextEvent = async () => {
            if (eventQueue.current.length === 0) {
                setTimeout(processNextEvent, 500);
                return;
            }

            const event = eventQueue.current.shift();
            await handleVisualEvent(event);

            // Dynamic delay based on queue depth
            const baseDelay = 1000;
            const delay = Math.max(100, baseDelay / Math.log2(eventQueue.current.length + 2));
            setTimeout(processNextEvent, delay);
        };

        processNextEvent();
    }, []);

    const createParticleBurst = (x: number, y: number, z: number, color: string, intensity: 'normal' | 'high' = 'normal') => {
        if (!graphRef.current) return;
        const scene = graphRef.current.scene();
        
        const count = intensity === 'high' ? 400 : 50; 
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const velocities: THREE.Vector3[] = [];
        
        for (let i = 0; i < count; i++) {
            positions[i * 3] = x;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = z;
            
            const speed = intensity === 'high' ? 5 : 2;
            velocities.push(new THREE.Vector3(
                (Math.random() - 0.5) * speed,
                (Math.random() - 0.5) * speed,
                (Math.random() - 0.5) * speed
            ));
        }
        
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const material = new THREE.PointsMaterial({
            color: new THREE.Color(color),
            size: intensity === 'high' ? 2 : 1.5,
            transparent: true,
            opacity: 1,
            blending: THREE.AdditiveBlending
        });
        
        const points = new THREE.Points(geometry, material);
        scene.add(points);
        
        let opacity = 1;
        const animateBurst = () => {
            if (opacity <= 0) {
                scene.remove(points);
                geometry.dispose();
                material.dispose();
                return;
            }
            
            const pos = geometry.attributes.position.array as Float32Array;
            for (let i = 0; i < count; i++) {
                pos[i * 3] += velocities[i].x;
                pos[i * 3 + 1] += velocities[i].y;
                pos[i * 3 + 2] += velocities[i].z;
            }
            geometry.attributes.position.needsUpdate = true;
            
            opacity -= 0.015;
            material.opacity = opacity;
            requestAnimationFrame(animateBurst);
        };
        animateBurst();
    };

    const pulseNode = async (nodeId: string, skipCameraMove = false) => {
        const node = graphData.current.nodes.find(n => n.id === nodeId);
        if (node && graphRef.current) {
            setTransientMessage({ text: node.name, type: 'FOCUS' });
            const scene = graphRef.current.scene();
            
            if (!skipCameraMove) {
                const distance = 80;
                const nodeX = node.x || 0;
                const nodeY = node.y || 0;
                const nodeZ = node.z || 0;
                const distRatio = 1 + distance / Math.hypot(nodeX, nodeY, nodeZ);

                graphRef.current.cameraPosition(
                    { x: nodeX * distRatio, y: nodeY * distRatio, z: nodeZ * distRatio }, 
                    node, 
                    2000
                );
                await new Promise(resolve => setTimeout(resolve, 1500));
            }

            const label = new (SpriteText as any)(node.id);
            label.color = '#ffffff';
            label.textHeight = 4;
            label.position.set(node.x || 0, (node.y || 0) + 10, node.z || 0);
            scene.add(label);
            createParticleBurst(node.x || 0, node.y || 0, node.z || 0, node.color);

            let nodeObj: any = null;
            scene.traverse((obj: any) => {
                if (obj.type === 'Group' && obj.__data && obj.__data.id === nodeId) {
                    nodeObj = obj;
                }
            });

            if (nodeObj) {
                const originalScale = nodeObj.scale.x;
                nodeObj.scale.set(originalScale * 3, originalScale * 3, originalScale * 3);
                await new Promise(resolve => setTimeout(resolve, 1000));
                nodeObj.scale.set(originalScale, originalScale, originalScale);
            }
            
            let labelOpacity = 1;
            const fadeLabel = () => {
                if (labelOpacity <= 0) {
                    scene.remove(label);
                    return;
                }
                labelOpacity -= 0.05;
                label.material.opacity = labelOpacity;
                requestAnimationFrame(fadeLabel);
            };
            fadeLabel();

            await new Promise(resolve => setTimeout(resolve, 500));
            setTransientMessage(null);
        }
    };
    
    const triggerSupernova = async (nodeIds: string[]) => {
        if (!graphRef.current) return;
        
        await new Promise(resolve => setTimeout(resolve, 1500));

        const affectedNodes = graphData.current.nodes.filter(n => nodeIds.includes(n.id));
        affectedNodes.forEach(node => {
            node.val = 20;
            createParticleBurst(node.x || 0, node.y || 0, node.z || 0, '#ffffff', 'high'); 
            createParticleBurst(node.x || 0, node.y || 0, node.z || 0, node.color, 'normal');
        });
        graphRef.current.graphData(graphData.current);

        await new Promise(resolve => setTimeout(resolve, 2000));

        affectedNodes.forEach(node => {
            node.val = 6; 
        });
        graphRef.current.graphData(graphData.current);
    };

    const ensureNodeExists = async (symbolId: string) => {
        if (!symbolId || symbolId === 'undefined') return false;
        if (graphData.current.nodes.find(n => n.id === symbolId)) return true;
        
        try {
            const s = await window.api.getSymbolById(symbolId);
            if (s) {
                graphData.current.nodes.push({
                    id: s.id,
                    name: s.name,
                    domain: s.symbol_domain,
                    val: 2,
                    color: getDomainColor(s.symbol_domain),
                    isCached: false
                });
                graphRef.current.graphData(graphData.current);
                return true;
            }
        } catch (e) {
            console.warn(`Could not find symbol ${symbolId}`, e);
        }
        return false;
    };
    
    const handleVisualEvent = async (event: any) => {
        const { type, data } = event;
        lastEventTime.current = Date.now();
        let logMsg = "";

        switch (type) {
            case 'symbol:upserted': logMsg = `Upserted Symbol: ${data.symbolId}`; break;
            case 'cache:load': logMsg = `Cache Load: ${data.symbolIds?.length || 1} symbols`; break;
            case 'cache:evict': logMsg = `Cache Evict: ${data.symbolIds?.length || 0} symbols`; break;
            case 'link:created': logMsg = `Linked: ${data.sourceId} -> ${data.targetId}`; break;
            case 'link:deleted': logMsg = `Link Deleted: ${data.sourceId} -> ${data.targetId}`; break;
            case 'trace:generated': logMsg = `Trace Generated: ${data.traceId}`; break;
        }

        if (logMsg) {
            setTransientMessage({ text: logMsg, type });
            if (type !== 'FOCUS') {
                setTimeout(() => setTransientMessage(prev => prev?.text === logMsg ? null : prev), 3000);
            }
        }

        switch (type) {
            case 'symbol:upserted': {
                const s = await window.api.getSymbolById(data.symbolId);
                if (s) {
                    let isNew = false;
                    const existingNode = graphData.current.nodes.find(n => n.id === s.id);
                    
                    if (!existingNode) {
                        graphData.current.nodes.push({
                            id: s.id,
                            name: s.name,
                            domain: s.symbol_domain,
                            val: 2,
                            color: getDomainColor(s.symbol_domain),
                            isCached: false
                        });
                        isNew = true;
                    } else {
                        existingNode.name = s.name;
                        existingNode.domain = s.symbol_domain;
                        existingNode.color = getDomainColor(s.symbol_domain);
                    }

                    if (s.linked_patterns && Array.isArray(s.linked_patterns)) {
                        for (const link of s.linked_patterns) {
                            const targetId = link?.id;
                            if (!targetId || targetId === 'undefined') continue;
                            const exists = await ensureNodeExists(targetId);
                            if (exists) {
                                const linkExists = graphData.current.links.some(l => {
                                    const src = typeof l.source === 'string' ? l.source : (l.source as any)?.id;
                                    const tgt = typeof l.target === 'string' ? l.target : (l.target as any)?.id;
                                    return (src === s.id && tgt === targetId) || (src === targetId && tgt === s.id);
                                });
                                if (!linkExists) {
                                    graphData.current.links.push({ source: s.id, target: targetId });
                                }
                            }
                        }
                    }

                    const node = graphData.current.nodes.find(n => n.id === s.id);
                    if (node) node.val = calculateNodeSize(s.id, node.isCached);
                    graphRef.current.graphData(graphData.current);
                    
                    if (isNew) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        await pulseNode(s.id);
                    }
                }
                break;
            }
            case 'cache:load': {
                const ids = data.symbolIds || [data.symbolId];
                const validIds: string[] = [];
                for (const id of ids) {
                    const exists = await ensureNodeExists(id);
                    if (exists) {
                        const node = graphData.current.nodes.find(n => n.id === id);
                        if (node) {
                            node.isCached = true;
                            validIds.push(id);
                        }
                    }
                }
                if (validIds.length > 0) await triggerSupernova(validIds);
                break;
            }
            case 'cache:evict': {
                const { symbolIds } = data;
                graphRef.current?.pauseAnimation();
                symbolIds.forEach((id: string) => {
                    const node = graphData.current.nodes.find(n => n.id === id);
                    if (node) {
                        node.isCached = false;
                        node.val = calculateNodeSize(id, false);
                    }
                });
                graphRef.current?.graphData(graphData.current);
                graphRef.current?.resumeAnimation();
                break;
            }
            case 'link:created': {
                const { sourceId, targetId } = data;
                const sExists = await ensureNodeExists(sourceId);
                const tExists = await ensureNodeExists(targetId);
                
                if (sExists && tExists) {
                    await pulseNode(sourceId);
                    graphData.current.links.push({ source: sourceId, target: targetId, color: '#00f0ff', width: 6 });
                    
                    const sNode = graphData.current.nodes.find(n => n.id === sourceId);
                    const tNode = graphData.current.nodes.find(n => n.id === targetId);
                    if (sNode) sNode.val = calculateNodeSize(sourceId, sNode.isCached);
                    if (tNode) tNode.val = calculateNodeSize(targetId, tNode.isCached);
                    graphRef.current.graphData(graphData.current);
                    
                    await pulseNode(targetId);

                    setTimeout(() => {
                        const link = graphData.current.links.find(l => 
                            (typeof l.source === 'string' ? l.source : (l.source as any).id) === sourceId && 
                            (typeof l.target === 'string' ? l.target : (l.target as any).id) === targetId
                        );
                        if (link) {
                            delete link.color;
                            delete link.width;
                            graphRef.current.graphData(graphData.current);
                        }
                    }, 4000);
                }
                break;
            }
            case 'link:deleted': {
                const { sourceId, targetId } = data;
                graphData.current.links = graphData.current.links.filter(l => {
                    const s = typeof l.source === 'string' ? l.source : (l.source as any).id;
                    const t = typeof l.target === 'string' ? l.target : (l.target as any).id;
                    return !(s === sourceId && t === targetId);
                });
                
                const sNode = graphData.current.nodes.find(n => n.id === sourceId);
                const tNode = graphData.current.nodes.find(n => n.id === targetId);
                if (sNode) sNode.val = calculateNodeSize(sourceId, sNode.isCached);
                if (tNode) tNode.val = calculateNodeSize(targetId, tNode.isCached);
                graphRef.current.graphData(graphData.current);
                break;
            }
        }
    };

    return (
        <div className="fixed inset-0 bg-black z-[100] flex flex-col font-mono text-white overflow-hidden">
            <div className="h-12 border-b border-white/10 flex items-center justify-between px-6 bg-black/80 backdrop-blur-md">
                <div className="flex items-center gap-3">
                    <Activity className={`${isLoading ? 'text-amber-500' : 'text-emerald-500'} animate-pulse`} size={20} />
                    <span className="font-bold tracking-tighter text-sm uppercase">
                        SignalZero Kernel Monitor 
                        <span className="ml-4 text-gray-500 font-normal normal-case">
                            {stats.nodes} Symbols • {stats.links} Links
                        </span>
                    </span>
                </div>
                <button onClick={() => window.close()} className="p-1 hover:text-white transition-colors">
                    <X size={16} />
                </button>
            </div>

            <div className="flex-1 w-full relative">
                <div ref={containerRef} className="absolute inset-0 z-10" />
                {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
                        <Activity className="text-emerald-500 animate-spin" size={48} />
                    </div>
                )}
            </div>

            <div className="h-16 flex items-center justify-center pointer-events-none relative">
                {transientMessage && (
                    <div className="flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]"></div>
                        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-emerald-400 drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">
                            {transientMessage.text}
                        </span>
                    </div>
                )}
            </div>

            <style>{`
                .symbol-tooltip {
                    background: rgba(0, 0, 0, 0.85);
                    border: 1px solid rgba(255, 255, 255, 0.2);
                    border-radius: 8px;
                    padding: 8px 12px;
                    color: white;
                }
                .tooltip-domain { font-size: 9px; text-transform: uppercase; opacity: 0.5; }
                .tooltip-id { font-size: 12px; font-weight: bold; color: #00f0ff; }
                .tooltip-name { font-size: 11px; }
            `}</style>
        </div>
    );
};
