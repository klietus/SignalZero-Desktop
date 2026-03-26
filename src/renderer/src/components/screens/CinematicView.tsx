
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

        const baseSize = isCached ? 8 : 4;
        return baseSize + (Math.log10(linkCount + 1) * 10);
    };

    // Initial Load
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
                            const size = node.val || 4;

                            // Outer Membrane (Opaque but Shaded)
                            const geometry = new THREE.SphereGeometry(size, 32, 32);
                            const color = new THREE.Color(node.color);
                            const material = new THREE.MeshStandardMaterial({
                                color: color,
                                transparent: false,
                                roughness: 0.4,
                                metalness: 0.3
                            });
                            const membrane = new THREE.Mesh(geometry, material);
                            group.add(membrane);

                            // Glowing Core (Opaque but Emissive)
                            const coreGeom = new THREE.SphereGeometry(size * 0.4, 16, 16);
                            const coreMat = new THREE.MeshStandardMaterial({
                                color: color,
                                emissive: color,
                                emissiveIntensity: node.isCached ? 5 : 1.2,
                                transparent: false
                            });
                            const core = new THREE.Mesh(coreGeom, coreMat);
                            core.name = 'core';
                            // Position it slightly forward so it's not completely Z-fighting if they overlap, 
                            // though membrane is much larger.
                            group.add(core);

                            group.userData = { isCached: node.isCached, baseEmissive: node.isCached ? 5 : 1.2 };
                            return group;
                        })
                        .linkThreeObject((link: any) => {
                            // Custom Tapered Organic Link
                            // We create a custom mesh that stretches between points
                            const geometry = new THREE.CylinderGeometry(1, 1, 1, 8, 8, true);
                            
                            // Transform vertices to taper in the middle
                            const pos = geometry.attributes.position;
                            for (let i = 0; i < pos.count; i++) {
                                const y = pos.getY(i); // range -0.5 to 0.5
                                const t = Math.abs(y * 2); // 0 at middle, 1 at ends
                                const scale = 0.2 + (t * 0.8); // 0.2 radius at middle, 1.0 at ends
                                pos.setX(i, pos.getX(i) * scale);
                                pos.setZ(i, pos.getZ(i) * scale);
                            }
                            pos.needsUpdate = true;

                            const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
                            const node = graphData.current.nodes.find(n => n.id === sourceId);
                            const color = new THREE.Color(node ? node.color : '#ffffff');

                            const material = new THREE.MeshBasicMaterial({
                                color: color,
                                transparent: true,
                                opacity: 0.2,
                                side: THREE.DoubleSide
                            });

                            return new THREE.Mesh(geometry, material);
                        })
                        .linkPositionUpdate((mode: any, { start, end }: any) => {
                            const { x: x1, y: y1, z: z1 } = start;
                            const { x: x2, y: y2, z: z2 } = end;
                            const length = Math.hypot(x2 - x1, y2 - y1, z2 - z1);
                            
                            mode.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
                            mode.lookAt(new THREE.Vector3(x2, y2, z2));
                            mode.rotateX(Math.PI / 2);
                            // Scale X and Z for thickness, Y for length
                            mode.scale.set(2.5, length, 2.5);
                            return true;
                        })
                        .linkCurvature(0.2)
                        .linkDirectionalParticles(1)
                        .linkDirectionalParticleWidth(3)
                        .linkDirectionalParticleSpeed(0.006)
                        .linkDirectionalParticleColor((link: any) => {
                             const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
                             return graphData.current.nodes.find(n => n.id === sourceId)?.color || '#ffffff';
                        })
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
                        const pulse = (Math.sin(timeSeconds * 2) + 1) * 0.5;

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

                            const targetDist = 2000;
                            const currentDist = Math.hypot(camera.position.x, camera.position.y, camera.position.z);
                            const distDiff = targetDist - currentDist;
                            if (Math.abs(distDiff) > 1) {
                                const zoomStep = distDiff * 0.001;
                                const ratio = (currentDist + zoomStep) / currentDist;
                                camera.position.x *= ratio;
                                camera.position.y *= ratio;
                                camera.position.z *= ratio;
                            }
                            camera.lookAt(0, 0, 0);
                            controls.target.set(0, 0, 0);
                        }

                        graphRef.current.scene().traverse((obj: any) => {
                            if (obj.type === 'Group' && obj.userData) {
                                const core = obj.getObjectByName('core');
                                if (core && core.material) {
                                    core.material.emissiveIntensity = obj.userData.baseEmissive + (pulse * 2);
                                    const s = 1 + (pulse * 0.1);
                                    core.scale.set(s, s, s);
                                }
                            }
                        });

                        requestAnimationFrame(animate);
                    };
                    animate();

                    const scene = graphRef.current.scene();
                    scene.add(new THREE.AmbientLight(0xffffff, 0.3));
                    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
                    directionalLight.position.set(1, 1, 1);
                    scene.add(directionalLight);
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

    useEffect(() => {
        const processNextEvent = async () => {
            if (eventQueue.current.length === 0) {
                setTimeout(processNextEvent, 500);
                return;
            }
            const event = eventQueue.current.shift();
            await handleVisualEvent(event);
            const baseDelay = 1000;
            const delay = Math.max(100, baseDelay / Math.log2(eventQueue.current.length + 2));
            setTimeout(processNextEvent, delay);
        };
        processNextEvent();
    }, []);

    const createParticleBurst = (x: number, y: number, z: number, color: string, intensity: 'normal' | 'high' = 'normal') => {
        if (!graphRef.current) return;
        const scene = graphRef.current.scene();
        const count = intensity === 'high' ? 130 : 15;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const velocities: THREE.Vector3[] = [];
        for (let i = 0; i < count; i++) {
            positions[i * 3] = x;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = z;
            const speed = intensity === 'high' ? 5 : 2;
            velocities.push(new THREE.Vector3((Math.random() - 0.5) * speed, (Math.random() - 0.5) * speed, (Math.random() - 0.5) * speed));
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const material = new THREE.PointsMaterial({ color: new THREE.Color(color), size: intensity === 'high' ? 2 : 1.5, transparent: true, opacity: 1, blending: THREE.AdditiveBlending });
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
            opacity -= 0.015; material.opacity = opacity;
            requestAnimationFrame(animateBurst);
        };
        animateBurst();
    };

    const flyToPath = async (nodeIds: string[]) => {
        if (!graphRef.current || !alive.current) return;
        
        // Sequential traversal
        for (const nodeId of nodeIds) {
            if (!alive.current) return;
            const node = graphData.current.nodes.find(n => n.id === nodeId);
            if (node) {
                // Fly to node
                const distance = 120;
                const nodeX = node.x || 0;
                const nodeY = node.y || 0;
                const nodeZ = node.z || 0;
                const hyp = Math.hypot(nodeX, nodeY, nodeZ) || 1;
                const distRatio = 1 + distance / hyp;
                
                graphRef.current.cameraPosition(
                    { x: nodeX * distRatio, y: nodeY * distRatio, z: nodeZ * distRatio }, 
                    node, 
                    1200 // Sequential movement
                );
                
                await pulseNode(nodeId, true); // skipCameraMove=true as we handle it here
                await new Promise(resolve => setTimeout(resolve, 800));
            }
        }

        if (!alive.current) return;
        // Final pull back
        const lastNode = graphData.current.nodes.find(n => n.id === nodeIds[nodeIds.length - 1]);
        if (lastNode) {
            graphRef.current.cameraPosition(
                { x: (lastNode.x || 0) * 1.5, y: (lastNode.y || 0) * 1.5, z: (lastNode.z || 0) * 1.5 },
                { x: 0, y: 0, z: 0 },
                2000
            );
        }
    };

    const pulseNode = async (nodeId: string, skipCameraMove = false) => {
        if (!alive.current) return;
        const node = graphData.current.nodes.find(n => n.id === nodeId);
        if (node && graphRef.current) {
            const scene = graphRef.current.scene();
            if (onSymbolFocus) onSymbolFocus(node.name || node.id);
            if (!skipCameraMove && alive.current) {
                const distance = 120;
                const nodeX = node.x || 0; const nodeY = node.y || 0; const nodeZ = node.z || 0;
                const distRatio = 1 + distance / Math.hypot(nodeX, nodeY, nodeZ);
                graphRef.current.cameraPosition({ x: nodeX * distRatio, y: nodeY * distRatio, z: nodeZ * distRatio }, node, 2000);
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
            if (!alive.current) return;
            const label = new (SpriteText as any)(node.id);
            label.color = '#ffffff'; label.textHeight = 6; label.position.set(node.x || 0, (node.y || 0) + 15, node.z || 0);
            scene.add(label);
            createParticleBurst(node.x || 0, node.y || 0, node.z || 0, node.color);
            let nodeObj: any = null;
            scene.traverse((obj: any) => { if (obj.type === 'Group' && obj.__data && obj.__data.id === nodeId) nodeObj = obj; });
            if (nodeObj && alive.current) {
                const originalScale = nodeObj.scale.x;
                nodeObj.scale.set(originalScale * 2.5, originalScale * 2.5, originalScale * 2.5);
                await new Promise(resolve => setTimeout(resolve, 800));
                if (!alive.current) return;
                nodeObj.scale.set(originalScale, originalScale, originalScale);
            }
            let labelOpacity = 1;
            const fadeLabel = () => {
                if (!alive.current) return;
                if (labelOpacity <= 0) { scene.remove(label); return; }
                labelOpacity -= 0.04; label.material.opacity = labelOpacity;
                requestAnimationFrame(fadeLabel);
            };
            fadeLabel();
            await new Promise(resolve => setTimeout(resolve, 400));
        }
    };

    const triggerSupernova = async (nodeIds: string[]) => {
        if (!graphRef.current) return;
        await new Promise(resolve => setTimeout(resolve, 1000));
        const affectedNodes = graphData.current.nodes.filter(n => nodeIds.includes(n.id));
        affectedNodes.forEach(node => {
            node.val = 25;
            createParticleBurst(node.x || 0, node.y || 0, node.z || 0, '#ffffff', 'high');
            createParticleBurst(node.x || 0, node.y || 0, node.z || 0, node.color, 'normal');
        });
        graphRef.current.graphData(graphData.current);
        await new Promise(resolve => setTimeout(resolve, 1500));
        affectedNodes.forEach(node => { node.val = calculateNodeSize(node.id, node.isCached); });
        graphRef.current.graphData(graphData.current);
    };

    const ensureNodeExists = async (symbolId: string) => {
        if (!symbolId || symbolId === 'undefined') return false;
        if (graphData.current.nodes.find(n => n.id === symbolId)) return true;
        try {
            const s = await window.api.getSymbolById(symbolId);
            if (s) {
                graphData.current.nodes.push({ id: s.id, name: s.name, domain: s.symbol_domain, val: 5, color: getDomainColor(s.symbol_domain), isCached: false });
                graphRef.current.graphData(graphData.current);
                return true;
            }
        } catch (e) { console.warn(`Could not find symbol ${symbolId}`, e); }
        return false;
    };

    const handleVisualEvent = async (event: any) => {
        const { type, data } = event;
        lastEventTime.current = Date.now();
        switch (type) {
            case 'symbol:upserted': {
                const s = await window.api.getSymbolById(data.symbolId);
                if (s) {
                    let isNew = false;
                    const existingNode = graphData.current.nodes.find(n => n.id === s.id);
                    if (!existingNode) {
                        graphData.current.nodes.push({ id: s.id, name: s.name, domain: s.symbol_domain, val: 5, color: getDomainColor(s.symbol_domain), isCached: false });
                        isNew = true;
                    } else {
                        existingNode.name = s.name; existingNode.domain = s.symbol_domain; existingNode.color = getDomainColor(s.symbol_domain);
                    }
                    if (s.linked_patterns && Array.isArray(s.linked_patterns)) {
                        for (const link of s.linked_patterns) {
                            const targetId = link?.id; if (!targetId || targetId === 'undefined') continue;
                            const exists = await ensureNodeExists(targetId);
                            if (exists) {
                                const linkExists = graphData.current.links.some(l => {
                                    const src = typeof l.source === 'string' ? l.source : (l.source as any)?.id;
                                    const tgt = typeof l.target === 'string' ? l.target : (l.target as any)?.id;
                                    return (src === s.id && tgt === targetId) || (src === targetId && tgt === s.id);
                                });
                                if (!linkExists) graphData.current.links.push({ source: s.id, target: targetId });
                            }
                        }
                    }
                    const node = graphData.current.nodes.find(n => n.id === s.id);
                    if (node) {
                        node.val = calculateNodeSize(s.id, node.isCached);
                        if (onSymbolFocus) onSymbolFocus(node.name || node.id);
                    }
                    graphRef.current.graphData(graphData.current);
                    if (isNew) { await new Promise(resolve => setTimeout(resolve, 1000)); await pulseNode(s.id); }
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
                        if (node) { node.isCached = true; validIds.push(id); }
                    }
                }
                if (validIds.length > 0) await triggerSupernova(validIds);
                break;
            }
            case 'cache:evict': {
                data.symbolIds.forEach((id: string) => {
                    const node = graphData.current.nodes.find(n => n.id === id);
                    if (node) { node.isCached = false; node.val = calculateNodeSize(id, false); }
                });
                graphRef.current?.graphData(graphData.current);
                break;
            }
            case 'link:created': {
                const { sourceId, targetId } = data;
                const sExists = await ensureNodeExists(sourceId); const tExists = await ensureNodeExists(targetId);
                if (sExists && tExists) {
                    await pulseNode(sourceId);
                    graphData.current.links.push({ source: sourceId, target: targetId, color: '#00f0ff', width: 6 });
                    graphRef.current.graphData(graphData.current);
                    await pulseNode(targetId);
                    setTimeout(() => {
                        const link = graphData.current.links.find(l =>
                            (typeof l.source === 'string' ? l.source : (l.source as any).id) === sourceId &&
                            (typeof l.target === 'string' ? l.target : (l.target as any).id) === targetId
                        );
                        if (link) { delete link.color; delete link.width; graphRef.current.graphData(graphData.current); }
                    }, 4000);
                }
                break;
            }
            case 'link:deleted': {
                graphData.current.links = graphData.current.links.filter(l => {
                    const s = typeof l.source === 'string' ? l.source : (l.source as any).id;
                    const t = typeof l.target === 'string' ? l.target : (l.target as any).id;
                    return !(s === data.sourceId && t === data.targetId);
                });
                graphRef.current.graphData(graphData.current);
                break;
            }
            case 'symbol:focused': {
                if (data.id) {
                    await ensureNodeExists(data.id);
                    await pulseNode(data.id);
                }
                break;
            }
            case 'trace:visualize': {
                const nodeIds: string[] = [];
                if (data.activation_path) {
                    for (const step of data.activation_path) {
                        const sId = step.symbol_id || step.id;
                        if (sId) {
                            await ensureNodeExists(sId);
                            nodeIds.push(sId);
                        }
                    }
                }
                if (data.output_node) {
                    await ensureNodeExists(data.output_node);
                    nodeIds.push(data.output_node);
                }
                
                if (nodeIds.length > 0) {
                    await flyToPath(nodeIds);
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
