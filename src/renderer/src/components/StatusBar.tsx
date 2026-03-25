
import React from 'react';
import { Cpu, Database, Layout, Zap, Loader2, Coins, Activity } from 'lucide-react';

interface StatusBarProps {
    modelName: string;
    isBusy: boolean;
    symbolCount: number;
    domainCount: number;
    cacheSize: number;
    lastRequestTokens?: number;
    focusedSymbolName?: string | null;
}

export const StatusBar: React.FC<StatusBarProps> = ({
    modelName,
    isBusy,
    symbolCount,
    domainCount,
    cacheSize,
    lastRequestTokens,
    focusedSymbolName
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
            </div>

            <div className="flex items-center gap-4">
                {isBusy && (
                    <div className="flex items-center gap-2 text-indigo-400 text-[9px] font-bold uppercase tracking-widest animate-in fade-in slide-in-from-bottom-1">
                        <Loader2 size={10} className="animate-spin" />
                        Symbolic_Recursion_Active
                    </div>
                )}
                <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${isBusy ? 'bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]' : 'bg-emerald-500/50 shadow-[0_0_8px_rgba(16,185,129,0.3)]'}`} />
                    <span className="text-[9px] font-mono text-gray-600 uppercase tracking-tighter">
                        Kernel_Live
                    </span>
                </div>
            </div>
        </div>
    );
};
