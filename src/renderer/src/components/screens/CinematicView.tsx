
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
                            const geometry = new THREE.SphereGeometry(size, 16, 16);
                            const color = new THREE.Color(node.color);
                            const material = new THREE.MeshStandardMaterial({
                                color: color,
                                transparent: true,
                                opacity: 0.7,
                                emissive: color,
                                emissiveIntensity: 0.5,
                                roughness: 0.2,
                                metalness: 0.1
                            });
                            const core = new THREE.Mesh(geometry, material);
                            group.add(core);
                            return group;
                        })
                        .linkWidth(1)
                        .linkOpacity(0.2)
                        .linkColor(() => '#444444')
                        .backgroundColor('rgba(0,0,0,0)')
                        .showNavInfo(false);

                    window.addEventListener('resize', handleResize);

                    const animate = () => {
                        if (!graphRef.current) return;
                        const time = Date.now();
                        const isIdle = (time - lastEventTime.current) > 10000;

                        if (isIdle) {
                            const camera = graphRef.current.camera();
                            const angle = 0.0005;
                            const x = camera.position.x;
                            const z = camera.position.z;
                            camera.position.x = x * Math.cos(angle) - z * Math.sin(angle);
                            camera.position.z = x * Math.sin(angle) + z * Math.cos(angle);
                            camera.lookAt(0, 0, 0);
                        }
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
        const process = async () => {
            if (eventQueue.current.length > 0) {
                const event = eventQueue.current.shift();
                await handleVisualEvent(event);
            }
            setTimeout(process, 1000);
        };
        process();
    }, []);

    const handleVisualEvent = async (event: any) => {
        const { type, data } = event;
        lastEventTime.current = Date.now();

        if (type === 'symbol:upserted') {
            const s = await window.api.getSymbolById(data.symbolId);
            if (s) {
                const existing = graphData.current.nodes.find(n => n.id === s.id);
                if (!existing) {
                    graphData.current.nodes.push({
                        id: s.id,
                        name: s.name,
                        domain: s.symbol_domain,
                        val: 3,
                        color: getDomainColor(s.symbol_domain),
                        isCached: false
                    });
                    graphRef.current.graphData(graphData.current);
                }
                setTransientMessage({ text: `Symbol Updated: ${s.id}` });
                setTimeout(() => setTransientMessage(null), 3000);
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
                    <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-emerald-400 animate-pulse">
                        {transientMessage.text}
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
