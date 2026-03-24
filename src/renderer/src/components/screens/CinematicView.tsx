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
    const [webglError, setWebglError] = useState<string | null>(null);
    const [stats, setStats] = useState({ nodes: 0, links: 0 });
    const [showTraceDialog, setShowTraceDialog] = useState(false);
    const [traceInput, setTraceInput] = useState("");
    const [transientMessage, setTransientMessage] = useState<{ text: string, type?: string } | null>(null);
    const [webSearchEvents, setWebSearchEvents] = useState<{ id: string, query: string, topResult?: any, timestamp: number }[]>([]);
    const eventQueue = useRef<any[]>([]);
    const lastEventTime = useRef<number>(Date.now());
    const graphData = useRef<{ nodes: GraphNode[], links: GraphLink[] }>({ nodes: [], links: [] });

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

    const isWebglSupported = () => {
        try {
            const canvas = document.createElement('canvas');
            return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
        } catch (e) { return false; }
    };

    useEffect(() => {
        let isMounted = true;
        const initGraph = async () => {
            if (!containerRef.current || !isWebglSupported()) {
                setWebglError("WebGL not supported.");
                setIsLoading(false);
                return;
            }
            
            setIsLoading(true);
            const domains = await window.api.listDomains();
            const nodeMap = new Map<string, GraphNode>();
            const tempLinks: { source: string, target: string }[] = [];

            for (const domainId of domains) {
                const results = await window.api.searchSymbols('', 1000, { metadata_filter: { symbol_domain: domainId } });
                const symbols = results.map(r => r.metadata);
                symbols.forEach((s: SymbolDef) => {
                    if (!nodeMap.has(s.id)) {
                        nodeMap.set(s.id, {
                            id: s.id, name: s.name, domain: domainId,
                            val: 2, color: getDomainColor(domainId), isCached: false
                        });
                    }
                    if (s.linked_patterns) {
                        s.linked_patterns.forEach(link => {
                            tempLinks.push({ source: s.id, target: link.id });
                        });
                    }
                });
            }

            if (!isMounted) return;
            const nodes = Array.from(nodeMap.values());
            const links = tempLinks.filter(l => nodeMap.has(l.target));
            graphData.current = { nodes, links };
            nodes.forEach(node => { node.val = calculateNodeSize(node.id, node.isCached); });
            setStats({ nodes: nodes.length, links: links.length });

            if (containerRef.current && !graphRef.current) {
                graphRef.current = (ForceGraph3D as any)()(containerRef.current)
                    .graphData(graphData.current)
                    .backgroundColor('rgba(0,0,0,0)')
                    .showNavInfo(false);
            }
            setIsLoading(false);
        };

        initGraph();

        window.api.onTraceLogged((trace) => {
            eventQueue.current.push({ type: 'TRACE_GENERATE', data: { trace } });
        });

        return () => {
            isMounted = false;
            window.api.removeInferenceListeners();
        };
    }, []);

    // Event Processor Loop (Simplified)
    useEffect(() => {
        const interval = setInterval(() => {
            if (eventQueue.current.length > 0) {
                const event = eventQueue.current.shift();
                setTransientMessage({ text: `Trace: ${event.data.trace.id}`, type: 'TRACE' });
                setTimeout(() => setTransientMessage(null), 3000);
            }
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="fixed inset-0 bg-black z-[100] flex flex-col font-mono text-white overflow-hidden">
            <div className="h-12 border-b border-white/10 flex items-center justify-between px-6 bg-black/80 backdrop-blur-md">
                <div className="flex items-center gap-3">
                    <Activity className={`${isLoading ? 'text-amber-500' : 'text-emerald-500'} animate-pulse`} size={20} />
                    <span className="font-bold text-sm uppercase">SignalZero Monitor <span className="ml-4 text-gray-500">{stats.nodes} Symbols</span></span>
                </div>
                <button onClick={() => window.close()} className="p-1 hover:text-white transition-colors"><X size={16} /></button>
            </div>
            <div className="flex-1 w-full relative">
                <div ref={containerRef} className="absolute inset-0" />
                {isLoading && <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10 pointer-events-none text-emerald-500">Initializing...</div>}
            </div>
            <div className="h-16 flex items-center justify-center pointer-events-none">
                {transientMessage && <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-emerald-400">{transientMessage.text}</span>}
            </div>
        </div>
    );
};
