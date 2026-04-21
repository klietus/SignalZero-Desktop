
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MessageSquare, Loader2, Activity } from 'lucide-react';
import { Message, Sender, UserProfile, ContextSession, ContextMessage, ProjectMeta, SymbolDef } from './types';
import { ChatMessage } from './components/ChatMessage';
import { ChatInput } from './components/ChatInput';
import { SettingsScreen } from './components/screens/SettingsScreen';
import { DomainScreen } from './components/screens/DomainScreen';
import { ProjectScreen } from './components/screens/ProjectScreen';
import { MonitoringScreen } from './components/screens/MonitoringScreen';
import { AgentScreen } from './components/screens/AgentScreen';
import { SymbolForgeScreen } from './components/screens/SymbolForgeScreen';
import { CinematicView } from './components/screens/CinematicView';
import { LogsScreen } from './components/screens/LogsScreen';
import { Header, HeaderProps } from './components/Header';
import { ContextListPanel } from './components/panels/ContextListPanel';
import { WorldMonitoringPanel } from './components/panels/WorldMonitoringPanel';
import { SetupScreen } from './components/screens/SetupScreen';
import { RealtimeScreen } from './components/screens/RealtimeScreen';
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
            sendMessage: (sessionId: string, message: string, systemInstruction?: string, metadata?: any) => Promise<any>;
            listDomains: () => Promise<string[]>;
            getDomain: (id: string) => Promise<any>;
            upsertDomain: (id: string, data: any) => Promise<any>;
            updateDomain: (id: string, data: any) => Promise<any>;
            getMetadata: () => Promise<any>;
            searchSymbols: (query: string, limit?: number, options?: any) => Promise<any[]>;
            upsertSymbol: (domainId: string, symbol: any) => Promise<any>;
            getSymbolsByDomain: (domainId: string) => Promise<any[]>;
            getSymbolById: (id: string) => Promise<any>;
            deleteSymbol: (domainId: string, symbolId: string) => Promise<boolean>;
            deleteDomain: (domainId: string) => Promise<boolean>;
            getSymbolCount: () => Promise<number>;
            getDomainCount: () => Promise<number>;
            getLinkCount: () => Promise<number>;
            getSettings: () => Promise<any>;
            updateSettings: (settings: any) => Promise<void>;
            validateMcp: (endpoint: string, token?: string) => Promise<any>;
            runHygiene: (strategy?: string) => Promise<any>;
            isInitialized: () => Promise<boolean>;
            pollSource: (sourceId: string) => Promise<any>;
            listDeltas: (filter?: any) => Promise<any[]>;
            regenerateDelta: (deltaId: string) => Promise<any>;
            processAttachment: (file: { name: string, path: string, type: string }) => Promise<{ id: string, filename: string, type: string, thumbnail?: string }>;
            processBase64Attachment: (file: { name: string, data: string, type: string }) => Promise<{ id: string, filename: string, type: string, thumbnail?: string }>;
            captureScreenshot: () => Promise<{ id: string, filename: string, type: string, thumbnail?: string } | null>;
            getRecentLogs: (limit?: number) => Promise<any[]>;
            getTraces: (sessionId: string) => Promise<any[]>;
            showEmojiPicker: () => Promise<void>;
            listAgents: () => Promise<any[]>;
            upsertAgent: (id: string, prompt: string, enabled: boolean, schedule?: string, subscriptions?: string[]) => Promise<any>;
            deleteAgent: (id: string) => Promise<boolean>;
            getAgentLogs: (agentId?: string, limit?: number, includeTraces?: boolean) => Promise<any[]>;
            getSystemPrompt: () => Promise<string>;
            setSystemPrompt: (prompt: string) => Promise<void>;
            getMcpPrompt: () => Promise<string>;
            setMcpPrompt: (prompt: string) => Promise<void>;
            exportProject: (meta: any) => Promise<any>;
            importProject: () => Promise<any>;
            importSampleProject: () => Promise<any>;
            openMonitor: () => Promise<void>;
            toggleVoiceMode: (active: boolean) => Promise<boolean>;
            streamAudioInput: (audioData: Float32Array) => void;
            onSttResult: (callback: (text: string) => void) => () => void;
            onPlayAudio: (callback: (data: { audio: Float32Array, samplingRate: number }) => void) => () => void;
            onPlayAudioB64: (callback: (data: { audio: string }) => void) => () => void;
            onPlayChunk: (callback: (data: { audio: string, index: number, isLast: boolean }) => void) => () => void;
            onStopPlayback: (callback: () => void) => () => void;
            onPlayAckBeep: (callback: () => void) => () => void;
            onVoiceMatch: (callback: (data: { score: number, speaker: string }) => void) => () => void;
            onTriggerSubmit: (callback: (data: { text: string, speaker?: string }) => void) => () => void;
            startVoiceEnrollment: (phrase: string) => void;
            nextVoiceEnrollmentPhrase: (phrase: string) => void;
            stopVoiceEnrollment: (name: string) => void;
            onVoiceEnrollProgress: (callback: (data: { count: number, verified: boolean, text: string }) => void) => () => void;
            onVoiceEnrollFinalized: (callback: (data: { profile: number[], name: string }) => void) => () => void;
            notifyPlaybackFinished: () => void;
            onInferenceChunk: (callback: (chunk: string) => void) => () => void;
            onInferenceCompleted: (callback: () => void) => () => void;
            onTraceLogged: (callback: (trace: any) => void) => () => void;
            onKernelEvent: (callback: (type: string, data: any) => void) => () => void;
            onNavigate: (callback: (view: string) => void) => () => void;
            onScreenshotCaptured: (callback: (attachment: any) => void) => () => void;
            getRealtimeState: () => Promise<any>;
            startRealtimeStream: (type: 'camera' | 'screen' | 'audio') => void;
            stopRealtimeStream: (type: 'camera' | 'screen' | 'audio') => void;
            onRealtimeUpdate: (callback: (update: { type: string, state: any }) => void) => () => void;
            onRealtimeStatusUpdate: (callback: (update: { type: string, status: any }) => void) => () => void;
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
    const [pendingAttachments, setPendingAttachments] = useState<any[]>([]);
    const [activeContextId, setActiveContextId] = useState<string | null>(null);
    const [contexts, setContexts] = useState<ContextSession[]>([]);
    const [messages, setMessages] = useState<Message[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);

    const [currentView, setCurrentView] = useState<'chat' | 'dev' | 'store' | 'project' | 'logs' | 'settings' | 'monitor' | 'world-monitor' | 'agents' | 'realtime'>('chat');
    const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);
    const [selectedSymbol, setSelectedSymbol] = useState<SymbolDef | null>(null);
    const [isGraphView, setIsGraphView] = useState(false);

    const [isTracePanelOpen, setIsTracePanelOpen] = useState(false);
    const [activeTraces, setActiveTraces] = useState<any[]>([]);
    const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);

    // Status Bar State
    const [modelName, setModelName] = useState('');
    const [symbolCount, setSymbolCount] = useState(0);
    const [linkCount, setLinkCount] = useState(0);
    const [domainCount, setDomainCount] = useState(0);
    const [cacheSize, setCacheSize] = useState(0);
    const [lastRequestTokens, setLastRequestTokens] = useState<number>(0);
    const [focusedSymbolName, setFocusedSymbolName] = useState<string | null>(null);
    const [lastVoiceScore, setLastVoiceScore] = useState<{ score: number, speaker: string } | null>(null);
    const [realtimeStatus, setRealtimeStatus] = useState<any>(null);

    useEffect(() => {
        // Initial fetch
        window.api.getRealtimeState().then(state => {
            setRealtimeStatus({
                audio: state.audio.status,
                camera: state.camera.status,
                screen: state.screen.status
            });
        });

        // Listen only for status changes (low frequency)
        const unbind = window.api.onRealtimeStatusUpdate((update) => {
            setRealtimeStatus(prev => {
                if (!prev) return prev;
                return { ...prev, [update.type]: update.status };
            });
        });
        return () => unbind();
    }, []);

    // Project Info
    const [projectMeta, setProjectMeta] = useState<ProjectMeta>({ name: 'SignalZero Desktop', version: '1.0', author: 'klietus', created_at: '', updated_at: '' });
    const [systemPrompt, setSystemPrompt] = useState(ACTIVATION_PROMPT);
    const [mcpPrompt, setMcpPrompt] = useState("");

    const [sidebarWidth, setSidebarWidth] = useState(350);
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
            const [sCount, lCount, dCount] = await Promise.all([
                window.api.getSymbolCount(),
                window.api.getLinkCount(),
                window.api.getDomainCount()
            ]);
            setSymbolCount(sCount || 0);
            setLinkCount(lCount || 0);
            setDomainCount(dCount || 0);
        } catch (e) { }
    };

    useEffect(() => {
        const checkInit = async () => {
            try {
                const urlParams = new URLSearchParams(window.location.search);
                const viewParam = urlParams.get('view');
                console.log(`[Debug] Initializing App. URL view param: '${viewParam}'`);

                if (viewParam === 'monitor' || viewParam === 'world-monitor') {
                    setCurrentView(viewParam);
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
            const sessionId = typeof chunk === 'object' ? chunk.sessionId : activeContextId;
            if (activeContextId && sessionId !== activeContextId) return;

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

        const unbindCompleted = window.api.onInferenceCompleted((data?: any) => {
            const sessionId = data?.sessionId || activeContextId;
            if (activeContextId && sessionId !== activeContextId) return;

            setIsProcessing(false);
            if (activeContextId) {
                window.api.getHistory(activeContextId).then(history => {
                    if (history) {
                        const grouped = groupHistoryByCorrelation(history);
                        setMessages(grouped);
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
            if (type === 'inference:tokens') {
                setLastRequestTokens(data.totalTokens || 0);
            }
            if (type === 'context:created') {
                setContexts(prev => {
                    if (prev.find(s => s.id === data.id)) return prev;
                    return [data, ...prev];
                });
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
            if (type === 'symbol:upserted' || type === 'symbol:deleted' || type === 'symbol:compression' || 
                type === 'domain:created' || type === 'tentative:create' || type === 'tentative:delete') {
                refreshSystemStats();
            }
        });

        const removeNavListener = window.api.onNavigate((view: any) => {
            if (view) setCurrentView(view);
        });

        const removeScreenshotListener = window.api.onScreenshotCaptured((attachment: any) => {
            if (attachment) {
                setPendingAttachments(prev => [...prev, attachment]);
            }
        });

        const unbindVoiceB64 = window.api.onPlayAudioB64(async (data: { audio: string }) => {
            try {
                const binaryStr = window.atob(data.audio);
                const bytes = new Uint8Array(binaryStr.length);
                for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
                
                const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
                const audioBuffer = await ctx.decodeAudioData(bytes.buffer);
                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(ctx.destination);
                source.onended = () => {
                    window.api.notifyPlaybackFinished();
                };
                source.start();
            } catch (e) {
                console.error("Failed to play b64 audio", e);
            }
        });

        // TTS Chunk Queueing
        let playbackQueue: AudioBuffer[] = [];
        let isPlaying = false;
        let lastChunkReceived = false;
        let currentSource: AudioBufferSourceNode | null = null;

        const processQueue = async (ctx: AudioContext) => {
            if (isPlaying || playbackQueue.length === 0) return;
            isPlaying = true;

            const buffer = playbackQueue.shift();
            if (buffer) {
                const source = ctx.createBufferSource();
                currentSource = source;
                source.buffer = buffer;
                source.connect(ctx.destination);
                source.onended = () => {
                    isPlaying = false;
                    currentSource = null;
                    if (playbackQueue.length > 0) {
                        // Add a half-second pause between sentences for more natural flow
                        setTimeout(() => processQueue(ctx), 500);
                    } else if (lastChunkReceived) {
                        window.api.notifyPlaybackFinished();
                        lastChunkReceived = false;
                    }
                };
                source.start();
            }
        };

        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

        const unbindVoiceChunk = window.api.onPlayChunk(async (data: { audio: string, index: number, isLast: boolean }) => {
            try {
                const binaryStr = window.atob(data.audio);
                const bytes = new Uint8Array(binaryStr.length);
                for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
                
                const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer);
                playbackQueue.push(audioBuffer);
                if (data.isLast) lastChunkReceived = true;
                
                processQueue(audioCtx);
            } catch (e) {
                console.error("Failed to play tts chunk", e);
            }
        });

        const unbindStopPlayback = window.api.onStopPlayback(() => {
            console.log("Stopping audio playback due to interruption...");
            if (currentSource) {
                try {
                    currentSource.stop();
                } catch (e) { /* ignore */ }
                currentSource = null;
            }
            playbackQueue = [];
            isPlaying = false;
            lastChunkReceived = false;
            window.api.notifyPlaybackFinished();
        });

        const unbindAckBeep = window.api.onPlayAckBeep(() => {
            try {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
                osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.1); // Slide down to A4
                
                gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
                
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                
                osc.start();
                osc.stop(audioCtx.currentTime + 0.1);
            } catch (e) {
                console.error("Failed to play ack beep", e);
            }
        });

        const unbindVoiceMatch = window.api.onVoiceMatch((data) => {
            setLastVoiceScore(data);
        });

        return () => {
            if (typeof unbindChunk === 'function') unbindChunk();
            if (typeof unbindCompleted === 'function') unbindCompleted();
            if (typeof unbindTrace === 'function') unbindTrace();
            if (typeof unbindKernel === 'function') unbindKernel();
            if (typeof removeNavListener === 'function') removeNavListener();
            if (typeof removeScreenshotListener === 'function') removeScreenshotListener();
            if (typeof unbindVoiceB64 === 'function') unbindVoiceB64();
            if (typeof unbindVoiceChunk === 'function') unbindVoiceChunk();
            if (typeof unbindStopPlayback === 'function') unbindStopPlayback();
            if (typeof unbindAckBeep === 'function') unbindAckBeep();
            if (typeof unbindVoiceMatch === 'function') unbindVoiceMatch();
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

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'm') {
                e.preventDefault();
                setCurrentView(prev => prev === 'world-monitor' ? 'chat' : 'world-monitor');
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const handleSendMessage = async (text: string, options?: { attachments?: { id: string, filename: string, type: string }[], metadata?: Record<string, any> }) => {
        if (!activeContextId || isProcessing) return;
        setIsProcessing(true);

        let finalMessage = text;
        if (options?.attachments && options.attachments.length > 0) {
            finalMessage += `\n\n<attachments>${JSON.stringify(options.attachments)}</attachments>`;
        }

        const userMsg: Message = { 
            id: 'temp-' + Date.now(), 
            role: Sender.USER, 
            content: text, 
            timestamp: new Date(), 
            metadata: { 
                attachments: options?.attachments,
                ...options?.metadata
            } 
        };
        setMessages(prev => [...prev, userMsg]);
        try {
            await window.api.sendMessage(activeContextId, finalMessage, systemPrompt, options?.metadata);
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
            case 'world-monitor':
                return <MonitoringScreen headerProps={getHeaderProps('World Monitoring')} />;
            case 'agents':
                return <AgentScreen headerProps={getHeaderProps('Agent Orchestrator')} />;
            case 'realtime':
                return <RealtimeScreen headerProps={getHeaderProps('Realtime Perception')} />;
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

    const isKernelActive = currentView === 'chat';

    return (
        <div className="relative flex flex-col h-screen overflow-hidden bg-gray-950 font-sans text-gray-100 selection:bg-indigo-500/30">
            
            {/* 1. KERNEL CONTAINER (Chat + Graph Experience) */}
            <div className={`absolute inset-0 flex flex-col transition-opacity duration-300 ${isKernelActive ? 'opacity-100 z-20' : 'opacity-0 z-0 pointer-events-none'}`}>
                
                {/* CinematicView (Graph) - Fixed background or focused view */}
                {showGraphviz && (
                    <div className={`absolute inset-0 transition-opacity duration-700 ${isGraphView ? 'opacity-100 z-20 pointer-events-auto' : 'opacity-20 z-0 pointer-events-none'}`}>
                        <CinematicView onSymbolFocus={setFocusedSymbolName} />
                    </div>
                )}

                {/* Kernel Header */}
                <div className="z-50 pointer-events-auto relative">
                    <Header {...getHeaderProps('Kernel', <MessageSquare size={18} className="text-indigo-400" />)}>
                        <button 
                            onClick={() => setCurrentView('agents')}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold uppercase tracking-widest transition-all ${
                                currentView === 'agents' 
                                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/20' 
                                : 'bg-gray-900 hover:bg-gray-800 text-gray-400 hover:text-emerald-400 border border-gray-800'
                            }`}
                        >
                            <Activity size={14} />
                            Agents
                        </button>
                        <button 
                            onClick={() => setCurrentView('realtime')}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold uppercase tracking-widest transition-all ${
                                currentView === 'realtime' 
                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' 
                                : 'bg-gray-900 hover:bg-gray-800 text-gray-400 hover:text-indigo-400 border border-gray-800'
                            }`}
                        >
                            <Activity size={14} />
                            Perception
                        </button>
                    </Header>
                </div>

                <div className={`flex-1 flex min-h-0 relative transition-all duration-300 ${isGraphView ? 'z-10 pointer-events-none' : 'z-30 pointer-events-auto'}`}>
                    {/* Sidebar */}
                    <div className={`pointer-events-auto h-full flex-shrink-0 flex flex-col transition-all duration-700 ${isGraphView ? 'opacity-0' : 'opacity-100'}`} style={{ width: isGraphView ? 0 : sidebarWidth, overflow: 'hidden' }}>
                        <div className="flex-1 min-h-0">
                            <ContextListPanel
                                contexts={contexts} activeContextId={activeContextId}
                                onSelectContext={setActiveContextId} onCreateContext={handleCreateContext}
                                onArchiveContext={handleArchiveContext} width={sidebarWidth}
                            />
                        </div>
                        <div className="h-1/2 min-h-0">
                            <WorldMonitoringPanel width={sidebarWidth} />
                        </div>
                    </div>

                    {!isGraphView && (
                        <div
                            className="pointer-events-auto w-1 hover:w-1.5 bg-transparent hover:bg-indigo-500/30 cursor-col-resize transition-all z-10 flex-shrink-0"
                            onMouseDown={startResizing}
                        />
                    )}

                    {/* Narrative Chat Area */}
                    <div className={`flex-1 flex flex-col min-w-0 transition-opacity duration-300 ${isGraphView ? 'opacity-0' : 'opacity-100 pointer-events-auto'}`}>
                        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-8 scroll-smooth bg-transparent">
                            <div className="w-full max-w-full mx-auto space-y-10 pb-12">
                                {messages.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center opacity-20 mt-32 text-center">
                                        <MessageSquare size={64} className="mb-4 mx-auto" />
                                        <p className="text-xl font-light tracking-widest uppercase">SignalZero Kernel</p>
                                        <p className="text-sm mt-2 font-mono">Ready for symbolic execution</p>
                                    </div>
                                ) : (
                                    messages.map((msg) => (
                                        <ChatMessage
                                            key={msg.id}
                                            message={msg}
                                            isVisible={isKernelActive && !isGraphView}
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
                                    ))
                                )}
                            </div>
                        </div>

                        <div className="p-6 bg-gradient-to-t from-gray-950 via-gray-950 to-transparent">
                            <div className="w-full max-w-full mx-auto">
                                <ChatInput
                                    onSend={handleSendMessage}
                                    disabled={isProcessing || !activeContextId}
                                    isProcessing={isProcessing}
                                    activeContextId={activeContextId}
                                    pendingAttachments={pendingAttachments}
                                    onClearPendingAttachments={() => setPendingAttachments([])}
                                    realtimeStatus={realtimeStatus}
                                />
                            </div>
                        </div>
                    </div>

                </div>

                {/* Kernel Status Bar */}
                <div className="z-50 pointer-events-auto relative">
                    <StatusBar
                        modelName={modelName} isBusy={isProcessing}
                        symbolCount={symbolCount} 
                        linkCount={linkCount}
                        domainCount={domainCount}
                        cacheSize={cacheSize}
                        lastRequestTokens={lastRequestTokens}
                        focusedSymbolName={focusedSymbolName}
                        lastVoiceScore={lastVoiceScore}
                        onNavigate={(v) => { setCurrentView(v); if (v !== 'chat') setIsGraphView(false); }}
                    />                        </div>            </div>

            {/* 2. OTHER SCREENS CONTAINER (Settings, Store, Project, Forge, Logs) */}
            <div className={`absolute inset-0 flex flex-col transition-opacity duration-300 ${!isKernelActive ? 'opacity-100 z-40 pointer-events-auto' : 'opacity-0 z-0 pointer-events-none'}`}>
                {renderCurrentView()}
            </div>

            {/* Global Trace Panel */}
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
    );
}

export default App;
