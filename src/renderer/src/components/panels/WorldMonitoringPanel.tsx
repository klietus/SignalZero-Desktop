
import React, { useState, useEffect } from 'react';
import { Globe, Clock, Activity, X } from 'lucide-react';
import { formatTimestamp } from '../utils/formatTimestamp';

interface WorldMonitoringPanelProps {
    width: number;
}

export const WorldMonitoringPanel: React.FC<WorldMonitoringPanelProps> = ({ width }) => {
    const [sources, setSources] = useState<any[]>([]);
    const [latestDeltas, setLatestDeltas] = useState<Record<string, any>>({});
    const [isLoading, setIsLoading] = useState(true);
    const [selectedDelta, setSelectedDelta] = useState<any>(null);

    const fetchData = async () => {
        try {
            const settings = await window.api.getSettings();
            const enabledSources = (settings.monitoring?.sources || []).filter((s: any) => s.enabled);
            setSources(enabledSources);

            const deltasMap: Record<string, any> = {};
            for (const source of enabledSources) {
                const deltas = await window.api.listDeltas({ sourceId: source.id, limit: 1 });
                if (deltas && deltas.length > 0) {
                    deltasMap[source.id] = deltas[0];
                }
            }
            setLatestDeltas(deltasMap);
        } catch (error) {
            console.error("Failed to fetch monitoring data", error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 60000); // Refresh every minute
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="flex flex-col h-full bg-gray-950 border-t border-gray-800" style={{ width }}>
            <div className="p-3 border-b border-gray-800 bg-gray-900/30 flex items-center gap-2">
                <Globe size={14} className="text-emerald-500" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 font-mono">Data_Feeds</span>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-800">
                {isLoading && sources.length === 0 ? (
                    <div className="p-4 flex justify-center">
                        <Activity size={16} className="text-indigo-500 animate-pulse" />
                    </div>
                ) : sources.length === 0 ? (
                    <div className="p-8 text-center opacity-20">
                        <p className="text-[10px] font-mono uppercase tracking-tighter">No_Sources_Enabled</p>
                    </div>
                ) : (
                    <div className="divide-y divide-gray-900">
                        {sources.map(source => {
                            const delta = latestDeltas[source.id];
                            return (
                                <div key={source.id} className="p-3 hover:bg-gray-900/40 transition-colors group">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className="text-[10px] font-bold text-gray-300 truncate pr-2 group-hover:text-emerald-400 transition-colors">
                                            {source.name}
                                        </span>
                                        <div className="flex items-center gap-1 shrink-0">
                                            <Clock size={10} className="text-gray-600" />
                                            <span className="text-[9px] font-mono text-gray-500">
                                                {source.lastPolledAt ? formatTimestamp(source.lastPolledAt) : 'NEVER'}
                                            </span>
                                        </div>
                                    </div>
                                    
                                    <div 
                                        className="relative h-16 overflow-hidden bg-black/20 rounded border border-gray-900 p-1.5 group-hover:border-emerald-500/30 transition-colors cursor-pointer"
                                        onClick={() => delta && setSelectedDelta({ ...delta, sourceName: source.name })}
                                    >
                                        {delta ? (
                                            <div className="text-[9px] font-mono text-gray-500 leading-tight animate-marquee-vertical">
                                                {delta.content}
                                            </div>
                                        ) : (
                                            <div className="text-[9px] font-mono text-gray-700 italic">
                                                Waiting_for_delta...
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Modal Overlay */}
            {selectedDelta && (
                <div 
                    className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-8 animate-in fade-in duration-200"
                    onClick={() => setSelectedDelta(null)}
                >
                    <div 
                        className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="p-6 border-b border-gray-800 flex items-center justify-between bg-gray-950/50">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-emerald-500/10 rounded-lg">
                                    <Globe size={20} className="text-emerald-500" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-gray-100">{selectedDelta.sourceName}</h3>
                                    <div className="flex items-center gap-2 text-xs text-gray-500 font-mono uppercase tracking-widest mt-0.5">
                                        <Clock size={12} />
                                        {formatTimestamp(selectedDelta.timestamp)}
                                    </div>
                                </div>
                            </div>
                            <button 
                                onClick={() => setSelectedDelta(null)}
                                className="p-2 hover:bg-gray-800 rounded-full transition-colors text-gray-400 hover:text-white"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-8 bg-gray-900/50">
                            <div className="text-xl leading-relaxed font-sans text-gray-200 whitespace-pre-wrap tracking-wide">
                                {selectedDelta.content}
                            </div>
                        </div>
                        <div className="p-4 border-t border-gray-800 bg-gray-950/30 flex justify-end">
                            <button 
                                onClick={() => setSelectedDelta(null)}
                                className="px-6 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-full text-sm font-bold transition-colors"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            <style dangerouslySetInnerHTML={{ __html: `
                @keyframes marquee-vertical {
                    0% { transform: translateY(0); }
                    100% { transform: translateY(-50%); }
                }
                .animate-marquee-vertical {
                    display: block;
                    animation: marquee-vertical 30s linear infinite;
                }
                .animate-marquee-vertical:hover {
                    animation-play-state: paused;
                }
            `}} />
        </div>
    );
};
