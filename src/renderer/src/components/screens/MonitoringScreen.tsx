import React, { useState, useEffect } from 'react';
import { 
    Activity, Filter, 
    ChevronRight, ChevronDown, Database, 
    RefreshCw, Globe, RotateCcw, Loader2
} from 'lucide-react';
import { Header, HeaderProps } from '../Header';
import { formatTimestamp } from '../utils/formatTimestamp';

interface MonitoringScreenProps {
    headerProps: HeaderProps;
}

export const MonitoringScreen: React.FC<MonitoringScreenProps> = ({ headerProps }) => {
    const [deltas, setDeltas] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [filterSource, setFilterSource] = useState('');
    const [filterPeriod, setFilterPeriod] = useState('');
    const [sources, setSources] = useState<any[]>([]);
    const [expandedDelta, setExpandedDelta] = useState<string | null>(null);
    const [isRegenerating, setIsRegenerating] = useState<string | null>(null);

    const periods = ['hour', 'day', 'week', 'month', 'year'];

    const handleRegenerate = async (deltaId: string) => {
        if (isRegenerating) return;
        setIsRegenerating(deltaId);
        try {
            const updated = await window.api.regenerateDelta(deltaId);
            if (updated) {
                setDeltas(prev => prev.map(d => d.id === deltaId ? updated : d));
            }
        } catch (error) {
            console.error("Failed to regenerate delta", error);
        } finally {
            setIsRegenerating(null);
        }
    };

    const loadData = async () => {
        setIsLoading(true);
        try {
            const settings = await window.api.getSettings();
            setSources(settings.monitoring?.sources || []);

            const result = await window.api.listDeltas({
                sourceId: filterSource || undefined,
                period: filterPeriod || undefined,
                limit: 100
            });
            setDeltas(result);
        } catch (error) {
            console.error("Failed to load deltas", error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [filterSource, filterPeriod]);

    return (
        <div className="flex flex-col h-full bg-gray-950 text-gray-100 font-sans overflow-hidden">
            <Header {...headerProps} />

            <div className="flex-1 flex flex-col min-h-0">
                {/* Filter Bar */}
                <div className="p-4 border-b border-gray-800 bg-gray-900/50 flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <Filter size={16} className="text-indigo-400" />
                        <span className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono">Filters</span>
                    </div>

                    <div className="flex items-center gap-2">
                        <select 
                            value={filterSource}
                            onChange={(e) => setFilterSource(e.target.value)}
                            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-xs font-mono focus:ring-1 focus:ring-indigo-500 outline-none"
                        >
                            <option value="">All Sources</option>
                            {sources.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>

                        <select 
                            value={filterPeriod}
                            onChange={(e) => setFilterPeriod(e.target.value)}
                            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-xs font-mono focus:ring-1 focus:ring-indigo-500 outline-none"
                        >
                            <option value="">All Periods</option>
                            {periods.map(p => (
                                <option key={p} value={p}>{p.toUpperCase()}</option>
                            ))}
                        </select>
                    </div>

                    <div className="ml-auto flex items-center gap-3">
                        <button 
                            onClick={loadData}
                            className="p-2 hover:bg-gray-800 rounded-full transition-colors text-gray-400"
                            title="Refresh"
                        >
                            <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
                        </button>
                    </div>
                </div>

                {/* Main Content */}
                <div className="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-gray-800">
                    {isLoading ? (
                        <div className="h-full flex items-center justify-center opacity-20">
                            <Activity size={48} className="animate-pulse" />
                        </div>
                    ) : deltas.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center opacity-20 py-20 text-center">
                            <Database size={64} className="mb-4 mx-auto" />
                            <p className="text-xl font-light tracking-widest uppercase font-mono">No_Deltas_Recorded</p>
                            <p className="text-sm mt-2 font-mono">World monitoring has not captured any changes yet.</p>
                        </div>
                    ) : (
                        <div className="max-w-5xl mx-auto space-y-4 pb-10">
                            {deltas.map((delta) => (
                                <div 
                                    key={delta.id} 
                                    className={`bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden transition-all duration-300 ${expandedDelta === delta.id ? 'ring-1 ring-indigo-500/50 shadow-lg shadow-indigo-500/10' : 'hover:border-gray-700'}`}
                                >
                                    <div 
                                        className="p-4 flex items-center gap-4 cursor-pointer"
                                        onClick={() => setExpandedDelta(expandedDelta === delta.id ? null : delta.id)}
                                    >
                                        <div className={`p-2 rounded-lg ${expandedDelta === delta.id ? 'bg-indigo-500/20 text-indigo-400' : 'bg-gray-800 text-gray-500'}`}>
                                            <Globe size={20} />
                                        </div>
                                        
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="font-bold text-sm tracking-tight text-gray-200">
                                                    {sources.find(s => s.id === delta.source_id)?.name || delta.source_id}
                                                </span>
                                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                                                    delta.period === 'hour' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                                                    delta.period === 'day' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                                    delta.period === 'week' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                                                    'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                                                }`}>
                                                    {delta.period}
                                                </span>
                                            </div>
                                            <div className="text-xs text-gray-500 font-mono truncate">
                                                {delta.content.substring(0, 150)}...
                                            </div>
                                        </div>

                                        <div className="text-right">
                                            <div className="text-[10px] font-mono text-gray-500 uppercase tracking-tighter mb-1">
                                                {formatTimestamp(delta.timestamp)}
                                            </div>
                                            <div className="flex justify-end">
                                                {expandedDelta === delta.id ? <ChevronDown size={16} className="text-indigo-400" /> : <ChevronRight size={16} className="text-gray-600" />}
                                            </div>
                                        </div>
                                    </div>

                                    {expandedDelta === delta.id && (
                                        <div className="px-4 pb-6 pt-2 border-t border-gray-800/50 animate-in fade-in slide-in-from-top-2 duration-300">
                                            <div className="bg-gray-950/50 rounded-lg p-6 border border-gray-800/50">
                                                {(() => {
                                                    const meta = typeof delta.metadata === 'string' ? JSON.parse(delta.metadata) : (delta.metadata || {});
                                                    return (
                                                        <>
                                                            {meta.imageUrl && (
                                                                <div className="mb-6 rounded-xl overflow-hidden border border-gray-800 shadow-xl max-h-80 bg-black/40 relative group">
                                                                    <img 
                                                                        src={meta.imageUrl} 
                                                                        alt="Delta Visual" 
                                                                        className="w-full h-full object-contain" 
                                                                    />
                                                                </div>
                                                            )}
                                                            
                                                            <div className="prose prose-invert prose-sm max-w-none">
                                                                <div className="whitespace-pre-wrap font-sans leading-relaxed text-gray-300 text-base">
                                                                    {delta.content}
                                                                </div>
                                                            </div>

                                                            <div className="mt-8 pt-4 border-t border-gray-800/50 flex flex-wrap items-center justify-between gap-4">
                                                                <div className="flex items-center gap-3">
                                                                    <button 
                                                                        onClick={() => handleRegenerate(delta.id)}
                                                                        disabled={!!isRegenerating}
                                                                        className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-emerald-500 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all group"
                                                                    >
                                                                        {isRegenerating === delta.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} className="group-hover:-rotate-180 transition-transform duration-500" />}
                                                                        {isRegenerating === delta.id ? 'Regenerating...' : 'Regenerate'}
                                                                    </button>

                                                                    {meta.articleUrl && (
                                                                        <a 
                                                                            href={meta.articleUrl} 
                                                                            target="_blank" 
                                                                            rel="noopener noreferrer"
                                                                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all"
                                                                        >
                                                                            <Globe size={14} /> View Source
                                                                        </a>
                                                                    )}
                                                                </div>

                                                                {delta.metadata && (
                                                                    <button 
                                                                        className="text-[10px] font-mono text-gray-600 hover:text-gray-400 underline"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            console.log("Delta Metadata:", meta);
                                                                            alert(JSON.stringify(meta, null, 2));
                                                                        }}
                                                                    >
                                                                        View_Raw_Meta
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </>
                                                    );
                                                })()}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
