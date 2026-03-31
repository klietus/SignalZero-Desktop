
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MessageSquare, Loader2 } from 'lucide-react';
import { Message, Sender, UserProfile, ContextSession, ContextMessage, ProjectMeta, SymbolDef } from './types';
import { ChatMessage } from './components/ChatMessage';
import { ChatInput } from './components/ChatInput';
import { SettingsScreen } from './components/screens/SettingsScreen';
import { DomainScreen } from './components/screens/DomainScreen';
import { ProjectScreen } from './components/screens/ProjectScreen';
import { SymbolForgeScreen } from './components/screens/SymbolForgeScreen';
import { CinematicView } from './components/screens/CinematicView';
import { LogsScreen } from './components/screens/LogsScreen';
import { Header, HeaderProps } from './components/Header';
import { ContextListPanel } from './components/panels/ContextListPanel';
import { SetupScreen } from './components/screens/SetupScreen';
import { TracePanel } from './components/panels/TracePanel';
import { StatusBar } from './components/StatusBar';

import { ACTIVATION_PROMPT } from './symbolic_system/activation_prompt';

// Declare global window.api for TypeScript
declare global {
    interface Window {
        api: {
            createContext: (type: string, metadata?: any, name?: string) => Promise<any>;
            listContexts: () => Promise<any[]>;
            getContext: (id: string) => Promise<any>;
            getHistory: (id: string) => Promise<any[]>;
            deleteContext: (id: string) => Promise<boolean>;
            sendMessage: (sessionId: string, message: string, systemInstruction?: string) => Promise<any>;
            listDomains: () => Promise<string[]>;
            getDomain: (id: string) => Promise<any>;
            upsertDomain: (id: string, data: any) => Promise<any>;
            updateDomain: (id: string, data: any) => Promise<any>;
            getMetadata: () => Promise<any[]>;
            searchSymbols: (query: string, limit?: number, options?: any) => Promise<any[]>;
            upsertSymbol: (domainId: string, symbol: any) => Promise<any>;
            getSymbolsByDomain: (domainId: string) => Promise<any[]>;
            getSymbolById: (id: string) => Promise<any>;
            deleteSymbol: (domainId: string, symbolId: string) => Promise<boolean>;
            deleteDomain: (domainId: string) => Promise<boolean>;
            getSymbolCount: () => Promise<number>;
            getDomainCount: () => Promise<number>;
            getSettings: () => Promise<any>;
            updateSettings: (settings: any) => Promise<void>;
            validateMcp: (endpoint: string, token?: string) => Promise<any>;
            runHygiene: (strategy?: string) => Promise<any>;
            isInitialized: () => Promise<boolean>;
            getRecentLogs: (limit?: number) => Promise<any[]>;
            getTraces: (sessionId: string) => Promise<any[]>;
            showEmojiPicker: () => Promise<void>;
            listAgents: () => Promise<any[]>;
            upsertAgent: (id: string, prompt: string, enabled: boolean, schedule?: string) => Promise<any>;
            deleteAgent: (id: string) => Promise<boolean>;
            getAgentLogs: (agentId?: string, limit?: number, includeTraces?: boolean) => Promise<any[]>;
            exportProject: (meta: any) => Promise<any>;
            importProject: () => Promise<any>;
            importSampleProject: () => Promise<any>;
            openMonitor: () => Promise<void>;
            onInferenceChunk: (callback: (chunk: string) => void) => () => void;
            onInferenceCompleted: (callback: () => void) => () => void;
            onTraceLogged: (callback: (trace: any) => void) => () => void;
            onKernelEvent: (callback: (type: string, data: any) => void) => () => void;
            onNavigate: (callback: (view: string) => void) => () => void;
            removeInferenceListeners: () => void;
            platform: string;
        }
    }
}

const mapToolCalls = (item: ContextMessage) => {
    if (!item || !item.toolCalls) return [];
    return item.toolCalls.map((tc: any, tcIdx: number) => {
        let args = {};
        const rawArgs = tc.arguments || tc.args;
        try { 
            args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : (rawArgs || {}); 
        } catch (e) { 
            args = { parseError: true, raw: rawArgs }; 
        }
        return { 
            id: tc.id || `${item.timestamp || Date.now()}-${tcIdx}`, 
            name: tc.name || item.toolName || 'tool', 
            args, 
            result: item.role === 'tool' ? item.content : undefined 
        };
    });
};

const mapSingleMessage = (item: ContextMessage): Message => {
    if (!item) return { id: 'err', role: Sender.SYSTEM, content: 'Invalid Message', timestamp: new Date() };
    const roleStr = (item.role || 'system').toLowerCase();
    const roleMap: Record<string, Sender> = {
        user: Sender.USER,
        model: Sender.MODEL,
        assistant: Sender.MODEL,
        system: Sender.SYSTEM,
        tool: Sender.MODEL
    };

    return {
        id: item.id || `${item.timestamp || Date.now()}`,
        role: roleMap[roleStr] || Sender.SYSTEM,
        content: item.content || '',
        timestamp: item.timestamp ? new Date(item.timestamp) : new Date(),
        toolCalls: mapToolCalls(item),
        correlationId: item.correlationId,
        toolCallId: item.toolCallId,
        metadata: item.metadata
    };
};

const groupHistoryByCorrelation = (history: ContextMessage[]): Message[] => {
    if (!Array.isArray(history)) return [];

    // Group raw messages by correlationId
    const groups = new Map<string, { user?: Message, assistants: Message[] }>();
    const order: string[] = [];

    for (const item of history) {
        if (!item || item.role === 'system') continue;

        const corrId = item.correlationId || (item.role === 'user' ? item.id : null) || 'orphan';

        if (!groups.has(corrId)) {
            groups.set(corrId, { assistants: [] });
            order.push(corrId);
        }

        const group = groups.get(corrId)!;
        const msg = mapSingleMessage(item);

        if (item.role === 'user') {
            group.user = msg;
        } else {
            group.assistants.push(msg);
        }
    }

    const grouped: Message[] = [];

    for (const corrId of order) {
        const group = groups.get(corrId)!;

        if (group.user) {
            grouped.push(group.user);
        }

        if (group.assistants.length > 0) {
            // Merge assistant messages for this correlation group
            const first = group.assistants[0];
            const allToolCalls = group.assistants.flatMap(m => m.toolCalls || []);

            // Map tool results back to their calls
            group.assistants.forEach(m => {
                if (m.toolCallId) {
                    const call = allToolCalls.find(tc => tc.id === m.toolCallId);
                    if (call) call.result = m.content;
                }
            });

            // Combine non-tool content
            const combinedContent = group.assistants
                .filter(m => !m.toolCallId && m.content && m.content.trim())
                .map(m => m.content)
                .join('\n\n');

            grouped.push({
                ...first,
                content: combinedContent,
                toolCalls: allToolCalls,
                isStreaming: group.assistants.some(m => m.isStreaming)
            });
        }
    }

    return grouped;
};

function App() {
    const defaultUser: UserProfile = { name: "Desktop User", email: "local@signalzero.desktop", picture: "" };

    const [appState, setAppState] = useState<'checking' | 'setup' | 'app'>('checking');
    const [activeContextId, setActiveContextId] = useState<string | null>(null);
    const [contexts, setContexts] = useState<ContextSession[]>([]);
    const [messages, setMessages] = useState<Message[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);

    const [currentView, setCurrentView] = useState<'chat' | 'dev' | 'store' | 'project' | 'logs' | 'settings' | 'monitor'>('chat');
    const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);
    const [selectedSymbol, setSelectedSymbol] = useState<SymbolDef | null>(null);
    const [isGraphView, setIsGraphView] = useState(false);

    const [isTracePanelOpen, setIsTracePanelOpen] = useState(false);
    const [activeTraces, setActiveTraces] = useState<any[]>([]);
    const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);

    // Status Bar State
    const [modelName, setModelName] = useState('');
    const [symbolCount, setSymbolCount] = useState(0);
    const [domainCount, setDomainCount] = useState(0);
    const [cacheSize, setCacheSize] = useState(0);
    const [lastRequestTokens, setLastRequestTokens] = useState<number>(0);
    const [focusedSymbolName, setFocusedSymbolName] = useState<string | null>(null);

    // Project Info
    const [projectMeta, setProjectMeta] = useState<ProjectMeta>({ name: 'SignalZero Desktop', version: '1.0', author: 'klietus', created_at: '', updated_at: '' });
    const [systemPrompt, setSystemPrompt] = useState(ACTIVATION_PROMPT);
    const [mcpPrompt, setMcpPrompt] = useState("");

    const [sidebarWidth, setSidebarWidth] = useState(260);
    const isResizing = useRef(false);
    const [showGraphviz, setShowGraphviz] = useState(true);

    const scrollRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = useCallback(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, []);

    useEffect(() => {
        if (currentView === 'chat' && messages.length > 0) {
            scrollToBottom();
        }
    }, [messages, currentView, scrollToBottom]);

    useEffect(() => {
        if (currentView === 'chat' && activeContextId) {
            // Give a small timeout to ensure DOM is ready after context switch
            setTimeout(scrollToBottom, 100);
        }
    }, [activeContextId, currentView, scrollToBottom]);

    useEffect(() => {
        if (currentView === 'chat' && !activeContextId && contexts.length > 0) {
            setActiveContextId(contexts[0].id);
        }
    }, [currentView, activeContextId, contexts]);

    const startResizing = useCallback(() => {
        isResizing.current = true;
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', stopResizing);
        document.body.style.cursor = 'col-resize';
    }, []);

    const stopResizing = useCallback(() => {
        isResizing.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', stopResizing);
        document.body.style.cursor = 'default';
    }, []);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isResizing.current) return;
        const newWidth = e.clientX;
        if (newWidth > 150 && newWidth < 600) {
            setSidebarWidth(newWidth);
        }
    }, []);


    const refreshSystemStats = async () => {
        try {
            const [sCount, dCount] = await Promise.all([
                window.api.getSymbolCount(),
                window.api.getDomainCount()
            ]);
            setSymbolCount(sCount || 0);
            setDomainCount(dCount || 0);
        } catch (e) { }
    };

    useEffect(() => {
        const checkInit = async () => {
            try {
                const urlParams = new URLSearchParams(window.location.search);
                const viewParam = urlParams.get('view');
                console.log(`[Debug] Initializing App. URL view param: '${viewParam}'`);

                if (viewParam === 'monitor') {
                    setCurrentView('monitor');
                    setAppState('app');
                    return;
                }

                const initialized = await window.api.isInitialized();
                if (initialized) {
                    const [list, settings] = await Promise.all([
                        window.api.listContexts(),
                        window.api.getSettings()
                    ]);

                    const active = Array.isArray(list) ? list.filter(c => c.status === 'open') : [];
                    setContexts(active);
                    if (active.length > 0 && !activeContextId) setActiveContextId(active[0].id);

                    if (settings?.inference?.systemPrompt) setSystemPrompt(settings.inference.systemPrompt);
                    if (settings?.inference?.mcpPrompt) setMcpPrompt(settings.inference.mcpPrompt);
                    if (settings?.inference?.model) setModelName(settings.inference.model);

                    setAppState('app');
                    refreshSystemStats();
                } else {
                    setAppState('setup');
                }
            } catch (e) {
                console.error("Init check failed", e);
                setAppState('setup');
            }
        };
        checkInit();
    }, []);

    useEffect(() => {
        if (appState !== 'app' || !activeContextId || currentView === 'monitor') {
            setMessages([]);
            return;
        }
        
        // Don't fetch history if we are currently processing a message, 
        // as it would overwrite the active streaming state.
        if (isProcessing) return;

        window.api.getHistory(activeContextId).then(history => {
            if (history) setMessages(groupHistoryByCorrelation(history));
        }).catch(e => console.error("History fetch failed", e));
    }, [activeContextId, appState, currentView, isProcessing]);

    useEffect(() => {
        if (appState !== 'app') return;

        const unbindChunk = window.api.onInferenceChunk((chunk: any) => {
            const text = typeof chunk === 'string' ? chunk : (chunk.text || '');
            const rawToolCalls = typeof chunk === 'object' ? (chunk.toolCalls || []) : [];
            
            const mappedToolCalls = rawToolCalls.map((tc: any, tcIdx: number) => {
                let args = {};
                try { args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.function.arguments || {}); }
                catch (e) { args = { parseError: true, raw: tc.function.arguments }; }
                return { 
                    id: tc.id || `streaming-${Date.now()}-${tcIdx}`, 
                    name: tc.function.name || 'tool', 
                    args 
                };
            });

            setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last && last.role === Sender.MODEL && last.isStreaming) {
                    const updated = [...prev];
                    updated[updated.length - 1] = { 
                        ...last, 
                        content: last.content + text,
                        toolCalls: mappedToolCalls.length > 0 ? [...(last.toolCalls || []), ...mappedToolCalls] : (last.toolCalls || [])
                    };
                    return updated;
                } else {
                    return [...prev, {
                        id: 'streaming-' + Date.now(),
                        role: Sender.MODEL,
                        content: text,
                        timestamp: new Date(),
                        isStreaming: true,
                        toolCalls: mappedToolCalls
                    }];
                }
            });
        });

        const unbindCompleted = window.api.onInferenceCompleted(() => {
            setIsProcessing(false);
            if (activeContextId) {
                window.api.getHistory(activeContextId).then(history => {
                    if (history) {
                        const grouped = groupHistoryByCorrelation(history);
                        setMessages(grouped);

                        const lastGroup = grouped[grouped.length - 1];
                        if (lastGroup && lastGroup.role === Sender.MODEL) {
                            const text = lastGroup.content || '';
                            const toolText = JSON.stringify(lastGroup.toolCalls || '');
                            setLastRequestTokens(Math.floor((text.length + toolText.length) / 3.5));
                        }
                    }
                });
            }
            refreshSystemStats();
        });

        const unbindTrace = window.api.onTraceLogged((trace) => {
            setActiveTraces(prev => [trace, ...prev].slice(0, 50));
        });

        const unbindKernel = window.api.onKernelEvent((type, data) => {
            if (type === 'cache:load') {
                setCacheSize(data.symbolIds?.length || 0);
            }
            if (type === 'context:updated') {
                setContexts(prev => prev.map(c =>
                    c.id === data.sessionId ? { ...c, name: data.name } : c
                ));
            }
            if (type === 'symbol:focused') {
                setFocusedSymbolName(data.name || data.id);
                // Clear after 3 seconds
                setTimeout(() => setFocusedSymbolName(null), 3000);
            }
        });

        const removeNavListener = window.api.onNavigate((view: any) => {
            if (view) setCurrentView(view);
        });

        return () => {
            if (typeof unbindChunk === 'function') unbindChunk();
            if (typeof unbindCompleted === 'function') unbindCompleted();
            if (typeof unbindTrace === 'function') unbindTrace();
            if (typeof unbindKernel === 'function') unbindKernel();
            if (typeof removeNavListener === 'function') removeNavListener();
        };
    }, [activeContextId, appState]);

    useEffect(() => {
        if (isTracePanelOpen && activeContextId) {
            window.api.getTraces(activeContextId).then(traces => {
                if (Array.isArray(traces)) {
                    setActiveTraces(traces.slice().reverse());
                }
            }).catch(e => console.error("Failed to fetch session traces", e));
        }
    }, [isTracePanelOpen, activeContextId]);

    useEffect(() => {
        if (appState === 'app') {
            window.api.getSettings().then(settings => {
                if (settings?.inference?.model) {
                    setModelName(settings.inference.model);
                }
                setShowGraphviz(settings?.ui?.showGraphviz ?? true);
            }).catch(() => {});
        }
    }, [currentView, appState]);

    const handleSendMessage = async (text: string) => {
        if (!activeContextId || isProcessing) return;
        setIsProcessing(true);
        const userMsg: Message = { id: 'temp-' + Date.now(), role: Sender.USER, content: text, timestamp: new Date() };
        setMessages(prev => [...prev, userMsg]);
        try {
            await window.api.sendMessage(activeContextId, text, systemPrompt);
        } catch (e) {
            setIsProcessing(false);
            console.error(e);
        }
    };

    const handleCreateContext = async () => {
        const session = await window.api.createContext('conversation');
        if (session) {
            setContexts(prev => [session, ...prev]);
            setActiveContextId(session.id);
            setCurrentView('chat');
        }
    };

    const handleArchiveContext = async (id: string) => {
        const success = await window.api.deleteContext(id);
        if (success) {
            setContexts(prev => prev.filter(c => c.id !== id));
            if (activeContextId === id) setActiveContextId(null);
        }
    };

    const getHeaderProps = (title: string, icon?: React.ReactNode): HeaderProps => ({
        title, icon, currentView,
        onNavigate: (v) => { setCurrentView(v); if (v !== 'chat') setIsGraphView(false); },
        onToggleTrace: () => setIsTracePanelOpen(prev => !prev),
        onToggleGraphView: () => setIsGraphView(prev => !prev),
        isGraphView,
        isTraceOpen: isTracePanelOpen,
        projectName: projectMeta.name
    });

    const renderCurrentView = () => {
        if (currentView === 'monitor') return <CinematicView onSymbolFocus={setFocusedSymbolName} />;

        switch (currentView) {
            case 'chat':
                return null; // Handled specially below for persistence
            case 'settings':
                return <SettingsScreen headerProps={getHeaderProps('Settings')} user={defaultUser} onLogout={() => { }} />;
            case 'store':
                return <DomainScreen headerProps={getHeaderProps('Domains')} onNavigateToForge={(id) => { setSelectedDomainId(id); setCurrentView('dev'); }} />;
            case 'project':
                return (
                    <ProjectScreen
                        headerProps={getHeaderProps('Project')}
                        projectMeta={projectMeta} setProjectMeta={setProjectMeta}
                        systemPrompt={systemPrompt} onSystemPromptChange={setSystemPrompt}
                        mcpPrompt={mcpPrompt} onMcpPromptChange={setMcpPrompt}
                        onNewProject={async () => {
                            const list = await window.api.listContexts();
                            setContexts(Array.isArray(list) ? list.filter(c => c.status === 'open') : []);
                            refreshSystemStats();
                        }}
                    />
                );
            case 'dev':
                return <SymbolForgeScreen headerProps={getHeaderProps('Symbol Forge')} initialDomain={selectedDomainId} initialSymbol={selectedSymbol} />;
            case 'logs':
                return <LogsScreen headerProps={getHeaderProps('System Logs')} />;
            default:
                return <div className="flex-1 flex items-center justify-center text-gray-500 font-mono uppercase tracking-[0.3em]">Module_Loading: {currentView}</div>;
        }
    };

    if (appState === 'checking') {
        return (
            <div className="h-screen w-full flex items-center justify-center bg-gray-950">
                <Loader2 className="animate-spin text-indigo-500" size={32} />
            </div>
        );
    }

    if (appState === 'setup') {
        return (
            <SetupScreen onComplete={() => {
                setAppState('app');
                window.api.listContexts().then(list => setContexts(Array.isArray(list) ? list.filter(c => c.status === 'open') : []));
                refreshSystemStats();
            }}
            />
        );
    }

    const isChatActive = currentView === 'chat';

    return (
        <div className="relative flex flex-col h-screen overflow-hidden bg-gray-950 font-sans text-gray-100 selection:bg-indigo-500/30">
            {showGraphviz && (
                <div className={`absolute inset-0 transition-opacity duration-700 ${isChatActive ? (isGraphView ? 'opacity-100 z-20 pointer-events-auto' : 'opacity-20 z-0 pointer-events-none') : 'opacity-0 z-0 pointer-events-none'}`}>
                    <CinematicView onSymbolFocus={setFocusedSymbolName} />
                </div>
            )}
            <div className={`flex-1 flex min-h-0 relative z-30 ${isChatActive ? 'pointer-events-none' : ''}`}>
                {/* Persistent Chat Sidebar */}
                <div className={`pointer-events-auto h-full flex-shrink-0 flex transition-all duration-700 ${isChatActive && !isGraphView ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} style={{ width: isChatActive && !isGraphView ? sidebarWidth : 0, overflow: 'hidden' }}>
                    <ContextListPanel
                        contexts={contexts} activeContextId={activeContextId}
                        onSelectContext={setActiveContextId} onCreateContext={handleCreateContext}
                        onArchiveContext={handleArchiveContext} width={sidebarWidth}
                    />
                </div>

                {isChatActive && !isGraphView && (
                    <div
                        className={`pointer-events-auto w-1 hover:w-1.5 bg-transparent hover:bg-indigo-500/30 cursor-col-resize transition-all z-10 flex-shrink-0`}
                        onMouseDown={startResizing}
                    />
                )}

                <div className={`flex-1 flex flex-col min-w-0 bg-transparent relative z-10`}>
                    {/* Persistent Chat View */}
                    <div className={`absolute inset-0 flex flex-col transition-opacity duration-300 
                        ${isChatActive && !isGraphView ? 'opacity-100 z-30 pointer-events-auto' : 'opacity-0 z-0 pointer-events-none'}`}>
                        <div className="flex flex-col h-full w-full">
                            <div className="pointer-events-auto w-full z-50">
                                <Header {...getHeaderProps('Kernel', <MessageSquare size={18} className="text-indigo-400" />)} />
                            </div>
                            
                            <div className={`flex-1 flex flex-col min-h-0`}>
                                <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-8 scroll-smooth bg-transparent pointer-events-none">
                                    <div className="w-full max-w-full mx-auto space-y-10 pb-12 pointer-events-none">
                                        {messages.length === 0 ? (
                                            <div className="h-full flex flex-col items-center justify-center opacity-20 mt-32 text-center pointer-events-none">
                                                <MessageSquare size={64} className="mb-4 mx-auto" />
                                                <p className="text-xl font-light tracking-widest uppercase">SignalZero Kernel</p>
                                                <p className="text-sm mt-2 font-mono">Ready for symbolic execution</p>
                                            </div>
                                        ) : (
                                            messages.map((msg) => (
                                                <div key={msg.id} className="pointer-events-auto">
                                                    <ChatMessage
                                                        message={msg}
                                                        isVisible={isChatActive && !isGraphView}
                                                        onSymbolClick={(_id, data) => { 
                                                            if (data) setSelectedSymbol(data);
                                                            setSelectedDomainId(data?.symbol_domain || null);
                                                            setCurrentView('dev'); 
                                                        }}
                                                        onDomainClick={(domain) => {
                                                            setSelectedDomainId(domain);
                                                            setCurrentView('dev');
                                                        }}
                                                        onTraceClick={(id) => {
                                                            if (id) setSelectedTraceId(id);
                                                            setIsTracePanelOpen(true);
                                                        }}
                                                        onRetry={handleSendMessage}
                                                    />
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>

                                <div className={`p-6 bg-gradient-to-t from-gray-950 via-gray-950 to-transparent pointer-events-none`}>
                                    <div className="w-full max-w-full mx-auto pointer-events-auto">
                                        <ChatInput onSend={handleSendMessage} disabled={isProcessing || !activeContextId} isProcessing={isProcessing} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Other Views (Settings, Store, etc) */}
                    <div className={`flex-1 flex flex-col min-h-0 transition-opacity duration-300
                        ${!isChatActive ? 'opacity-100 z-30 pointer-events-auto' : 'opacity-0 z-0 pointer-events-none'}`}>
                        {renderCurrentView()}
                    </div>

                    {/* Popout Trace Panel */}
                    <TracePanel
                        isOpen={isTracePanelOpen}
                        onClose={() => setIsTracePanelOpen(false)}
                        traces={activeTraces}
                        selectedTraceId={selectedTraceId}
                        onSelectTrace={setSelectedTraceId}
                        onSymbolClick={(_id, data) => { 
                            if (data) setSelectedSymbol(data);
                            setSelectedDomainId(data?.symbol_domain || null);
                            setCurrentView('dev'); 
                            setIsTracePanelOpen(false); 
                        }}
                    />
                </div>
            </div>
            
            <div className={`pointer-events-auto z-30 relative transition-opacity duration-300 ${isChatActive ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                <StatusBar
                    modelName={modelName} isBusy={isProcessing}
                    symbolCount={symbolCount} domainCount={domainCount}
                    cacheSize={cacheSize}
                    lastRequestTokens={lastRequestTokens}
                    focusedSymbolName={focusedSymbolName}
                />
            </div>
        </div>
    );
}

export default App;
