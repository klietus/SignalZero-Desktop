
import React, { useState, useEffect, useRef } from 'react';
import { Search, Trash2, ChevronDown, Clock, Filter, Activity } from 'lucide-react';
import { Header, HeaderProps } from '../Header';

interface LogEntry {
    timestamp: string;
    level: string;
    category: string;
    message: string;
    [key: string]: any;
}

interface LogsScreenProps {
    headerProps: Omit<HeaderProps, 'children'>;
}

export const LogsScreen: React.FC<LogsScreenProps> = ({ headerProps }) => {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [filter, setFilter] = useState('');
    const [levelFilter, setLevelFilter] = useState<string>('all');
    const scrollRef = useRef<HTMLDivElement>(null);
    const [autoScroll, setAutoScroll] = useState(true);

    useEffect(() => {
        // Initial load from file
        const loadInitialLogs = async () => {
            try {
                const initialLogs = await window.api.getRecentLogs(200);
                if (initialLogs && initialLogs.length > 0) {
                    setLogs(initialLogs);
                }
            } catch (error) {
                console.error("Failed to load initial logs", error);
            }
        };
        loadInitialLogs();

        const removeListener = window.api.onKernelEvent((type, data) => {
            if (type === 'system:log') {
                setLogs(prev => [...prev, data].slice(-500));
            }
        });
        return () => { if (typeof removeListener === 'function') removeListener(); };
    }, []);

    useEffect(() => {
        if (autoScroll && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs, autoScroll]);

    const filteredLogs = logs.filter(log => {
        const matchesText = !filter || 
            log.message.toLowerCase().includes(filter.toLowerCase()) || 
            log.category.toLowerCase().includes(filter.toLowerCase());
        const matchesLevel = levelFilter === 'all' || log.level === levelFilter;
        return matchesText && matchesLevel;
    });

    const getLevelColor = (level: string) => {
        switch (level.toLowerCase()) {
            case 'error': return 'text-red-400';
            case 'warn': return 'text-amber-400';
            case 'info': return 'text-blue-400';
            case 'debug': return 'text-gray-500';
            default: return 'text-gray-300';
        }
    };

    return (
        <div className="flex flex-col h-full bg-gray-950 font-mono text-xs">
            <Header {...headerProps}>
                <div className="flex items-center gap-4 bg-black/40 border border-gray-800 rounded-lg px-3 py-1.5">
                    <div className="flex items-center gap-2 border-r border-gray-800 pr-4">
                        <Filter size={12} className="text-gray-500" />
                        <select 
                            value={levelFilter} 
                            onChange={e => setLevelFilter(e.target.value)}
                            className="bg-transparent border-none text-gray-400 focus:ring-0 uppercase tracking-tighter cursor-pointer"
                        >
                            <option value="all">All_Levels</option>
                            <option value="error">Errors</option>
                            <option value="warn">Warnings</option>
                            <option value="info">Info</option>
                            <option value="debug">Debug</option>
                        </select>
                    </div>
                    <div className="flex items-center gap-2">
                        <Search size={12} className="text-gray-500" />
                        <input 
                            placeholder="Filter_Output..." 
                            value={filter} 
                            onChange={e => setFilter(e.target.value)}
                            className="bg-transparent border-none text-gray-300 focus:ring-0 placeholder-gray-700 w-40"
                        />
                    </div>
                    <button 
                        onClick={() => setLogs([])}
                        className="p-1 hover:text-red-400 text-gray-600 transition-colors"
                        title="Clear Buffer"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            </Header>

            <div className="flex-1 overflow-hidden flex flex-col relative">
                <div 
                    ref={scrollRef}
                    className="flex-1 overflow-y-auto p-4 space-y-1 selection:bg-indigo-500/30"
                    onScroll={e => {
                        const target = e.currentTarget;
                        const isAtBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 50;
                        setAutoScroll(isAtBottom);
                    }}
                >
                    {filteredLogs.map((log, i) => (
                        <div key={i} className="flex gap-4 group hover:bg-gray-900/50 p-1 rounded transition-colors border-l-2 border-transparent hover:border-indigo-500/20">
                            <div className="text-gray-600 shrink-0 font-light opacity-50 flex items-center gap-1 min-w-[140px]">
                                <Clock size={10} />
                                {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, fractionalSecondDigits: 3 } as any)}
                            </div>
                            <div className={`shrink-0 uppercase font-bold w-12 ${getLevelColor(log.level)}`}>
                                {log.level}
                            </div>
                            <div className="shrink-0 text-indigo-500/60 font-bold uppercase w-20 truncate">
                                [{log.category}]
                            </div>
                            <div className="text-gray-300 break-all leading-relaxed flex-1">
                                {log.message}
                                {Object.keys(log).filter(k => !['timestamp', 'level', 'category', 'message', 'id'].includes(k)).length > 0 && (
                                    <span className="text-[10px] text-gray-600 ml-2 italic">
                                        {JSON.stringify(Object.fromEntries(Object.entries(log).filter(([k]) => !['timestamp', 'level', 'category', 'message', 'id'].includes(k))))}
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}
                    {filteredLogs.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center text-gray-700 space-y-4">
                            <Activity size={48} className="opacity-20" />
                            <div className="uppercase tracking-[0.3em] font-light">Awaiting_System_Output</div>
                        </div>
                    )}
                </div>

                {!autoScroll && filteredLogs.length > 0 && (
                    <button 
                        onClick={() => setAutoScroll(true)}
                        className="absolute bottom-6 right-8 bg-indigo-600 text-white px-4 py-2 rounded-full shadow-2xl flex items-center gap-2 hover:bg-indigo-500 transition-all animate-bounce text-[10px] font-bold uppercase tracking-widest"
                    >
                        <ChevronDown size={14} /> Resume_Auto_Scroll
                    </button>
                )}
            </div>

            <div className="h-8 border-t border-gray-900 bg-black/40 flex items-center justify-between px-6 shrink-0">
                <div className="flex items-center gap-4 text-[10px] text-gray-600 uppercase tracking-tighter">
                    <span>Buffer: {logs.length}/500 Entries</span>
                    <span>Visible: {filteredLogs.length}</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-gray-600 font-mono">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                    Kernel_Logger_Attached
                </div>
            </div>
        </div>
    );
};
