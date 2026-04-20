
import React from 'react';
import { Cpu, Database, Layout, Zap, Loader2, Coins, Activity, Mic } from 'lucide-react';

interface StatusBarProps {
    modelName: string;
    isBusy: boolean;
    symbolCount: number;
    linkCount: number;
    domainCount: number;
    cacheSize: number;
    lastRequestTokens?: number;
    focusedSymbolName?: string | null;
    lastVoiceScore?: { score: number, speaker: string } | null;
    onNavigate: (view: any) => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({
    modelName,
    isBusy,
    symbolCount,
    linkCount,
    domainCount,
    cacheSize,
    lastRequestTokens,
    focusedSymbolName,
    lastVoiceScore,
    onNavigate
}) => {
    return (
        <div className="h-8 bg-gray-950 border-t border-gray-800 flex items-center justify-between px-6 shrink-0 z-50 overflow-hidden select-none">
            <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                    <Cpu size={12} className={isBusy ? "text-indigo-400 animate-pulse" : "text-gray-600"} />
                    <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest truncate max-w-[200px]">
                        Model: <span className="text-gray-300">{modelName || 'OFFLINE'}</span>
                    </span>
                </div>

                <div className="flex items-center gap-2 border-l border-gray-800 pl-6">
                    <Database size={12} className="text-gray-600" />
                    <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">
                        Symbols: <span className="text-emerald-500 font-bold">{symbolCount}</span>
                    </span>
                </div>

                <div className="flex items-center gap-2 border-l border-gray-800 pl-6">
                    <Activity size={12} className="text-gray-600" />
                    <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">
                        Lattice_Links: <span className="text-indigo-400 font-bold">{linkCount}</span>
                    </span>
                </div>

                <div className="flex items-center gap-2 border-l border-gray-800 pl-6 cursor-pointer hover:bg-gray-900 px-2 py-1 rounded transition-colors" onClick={() => onNavigate('store')}>
                    <Layout size={12} className="text-gray-600" />
                    <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">
                        Domains: <span className="text-indigo-400 font-bold">{domainCount}</span>
                    </span>
                </div>

                <div className="flex items-center gap-2 border-l border-gray-800 pl-6">
                    <Zap size={12} className="text-gray-600" />
                    <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">
                        Working_Set: <span className="text-amber-500 font-bold">{cacheSize}</span>
                    </span>
                </div>

                {lastRequestTokens !== undefined && (
                    <div className="flex items-center gap-2 border-l border-gray-800 pl-6">
                        <Coins size={12} className="text-gray-600" />
                        <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">
                            Last_Request: <span className="text-indigo-300 font-bold">{lastRequestTokens} tokens</span>
                        </span>
                    </div>
                )}

                {focusedSymbolName && (
                    <div className="flex items-center gap-2 border-l border-gray-800 pl-6 animate-in fade-in slide-in-from-left-2 duration-300">
                        <Activity size={12} className="text-emerald-400 animate-pulse" />
                        <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">
                            Focusing: <span className="text-emerald-400 font-bold">{focusedSymbolName}</span>
                        </span>
                    </div>
                )}

                {lastVoiceScore && (
                    <div className="flex items-center gap-2 border-l border-gray-800 pl-6 animate-in fade-in slide-in-from-left-2 duration-300">
                        <Mic size={12} className="text-gray-600" />
                        <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">
                            Voice_Match: <span className={lastVoiceScore.score > 0.7 ? "text-emerald-500 font-bold" : "text-amber-500 font-bold"}>
                                {Math.round(lastVoiceScore.score * 100)}%
                            </span>
                            <span className="ml-2 opacity-50 text-[9px]">({lastVoiceScore.speaker})</span>
                        </span>
                    </div>
                )}
            </div>

            <div className="flex items-center gap-4">
                {isBusy && (
                    <div className="flex items-center gap-2 text-indigo-400 text-[9px] font-bold uppercase tracking-widest animate-in fade-in slide-in-from-bottom-1">
                        <Loader2 size={10} className="animate-spin" />
                        Symbolic_Recursion_Active
                    </div>
                )}
            </div>
        </div>
    );
};
