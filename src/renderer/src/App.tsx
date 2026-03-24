import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { MessageSquare, Database, Loader2 } from 'lucide-react';
import { Message, Sender, UserProfile, TraceData, SymbolDef, ProjectMeta, ProjectImportStats, ContextSession, ContextMessage, ContextHistoryGroup } from './types';
import { ChatMessage } from './components/ChatMessage';
import { ChatInput } from './components/ChatInput';
import { SettingsScreen } from './components/screens/SettingsScreen';
import { Header, HeaderProps } from './components/Header';
import { ContextListPanel } from './components/panels/ContextListPanel';
// Panels
import { SymbolDetailPanel } from './components/panels/SymbolDetailPanel';
import { DomainPanel } from './components/panels/DomainPanel';
import { TracePanel } from './components/panels/TracePanel';
// Screens
import { SymbolDevScreen } from './components/screens/SymbolDevScreen';
import { SymbolStoreScreen } from './components/screens/SymbolStoreScreen';
import { TestRunnerScreen } from './components/screens/TestRunnerScreen';
import { ProjectScreen } from './components/screens/ProjectScreen';
import { ContextScreen } from './components/screens/ContextScreen';
import { HelpScreen } from './components/screens/HelpScreen';
import { AgentsScreen } from './components/screens/AgentsScreen';
import { CinematicView } from './components/screens/CinematicView';

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
      getMetadata: () => Promise<any[]>;
      searchSymbols: (query: string, limit?: number, options?: any) => Promise<any[]>;
      upsertSymbol: (domainId: string, symbol: any) => Promise<any>;
      getSettings: () => Promise<any>;
      updateSettings: (settings: any) => Promise<void>;
      onInferenceChunk: (callback: (chunk: string) => void) => void;
      onInferenceCompleted: (callback: () => void) => void;
      removeInferenceListeners: () => void;
    }
  }
}

const mapSingleContextMessage = (item: ContextMessage): Message => {
    const roleStr = (item.role || 'system').toLowerCase();
    const roleMap: Record<string, Sender> = {
        user: Sender.USER,
        model: Sender.MODEL,
        assistant: Sender.MODEL,
        system: Sender.SYSTEM,
        tool: Sender.MODEL
    };
    const role = roleMap[roleStr] || Sender.SYSTEM;
    
    const toolCalls = item.toolCalls?.map((tc: any, tcIdx: number) => {
        let args = {};
        try {
            args = typeof tc.arguments === 'string' ? JSON.parse(tc.arguments) : (tc.arguments || {});
        } catch (e) {
            args = { parseError: true, raw: tc.arguments };
        }
        return {
            id: tc.id || `${item.timestamp}-${tcIdx}`,
            name: tc.name || item.toolName || 'tool',
            args
        };
    });

    return {
        id: item.id || `${item.timestamp}`,
        role,
        content: item.content || '',
        timestamp: new Date(item.timestamp),
        toolCalls,
        correlationId: item.correlationId,
        toolCallId: item.toolCallId,
        metadata: item.metadata
    };
};

function App() {
  const defaultUser: UserProfile = { name: "Desktop User", email: "local@signalzero.desktop", picture: "" };
  
  // State
  const [activeContextId, setActiveContextId] = useState<string | null>(null);
  const [contexts, setContexts] = useState<ContextSession[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [user, setUser] = useState<UserProfile>(defaultUser);
  const [currentView, setCurrentView] = useState<'context' | 'chat' | 'dev' | 'store' | 'test' | 'project' | 'help' | 'agents' | 'settings' | 'monitor'>('chat');
  
  const [activeSystemPrompt, setActiveSystemPrompt] = useState<string>(ACTIVATION_PROMPT);
  const [selectedSymbolId, setSelectedSymbolId] = useState<string | null>(null);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [traceLog, setTraceLog] = useState<TraceData[]>([]);
  const [isTracePanelOpen, setIsTracePanelOpen] = useState(false);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);

  // Resize Sidebar
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [isResizing, setIsResizing] = useState(false);

  // Initial Load
  useEffect(() => {
    window.api.listContexts().then(list => {
        const active = list.filter(c => c.status === 'open');
        setContexts(active);
        if (active.length > 0 && !activeContextId) {
            setActiveContextId(active[0].id);
        }
    });
  }, []);

  // History Sync
  useEffect(() => {
    if (activeContextId) {
        window.api.getHistory(activeContextId).then(history => {
            setMessages(history.map(mapSingleContextMessage));
        });
    } else {
        setMessages([]);
    }
  }, [activeContextId]);

  // Streaming Listener
  useEffect(() => {
    window.api.onInferenceChunk((text) => {
        setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last && last.role === Sender.MODEL) {
                const updated = [...prev];
                updated[updated.length - 1] = { ...last, content: last.content + text, isStreaming: true };
                return updated;
            } else {
                return [...prev, {
                    id: 'streaming-' + Date.now(),
                    role: Sender.MODEL,
                    content: text,
                    timestamp: new Date(),
                    isStreaming: true
                }];
            }
        });
    });

    window.api.onInferenceCompleted(() => {
        setIsProcessing(false);
        // Refresh history to get final tool calls and formatted response
        if (activeContextId) {
            window.api.getHistory(activeContextId).then(history => {
                setMessages(history.map(mapSingleContextMessage));
            });
        }
    });

    return () => window.api.removeInferenceListeners();
  }, [activeContextId]);

  const handleSendMessage = async (text: string) => {
      if (!activeContextId || isProcessing) return;

      setIsProcessing(true);
      // Optimistic user message
      const userMsg: Message = {
          id: 'temp-' + Date.now(),
          role: Sender.USER,
          content: text,
          timestamp: new Date()
      };
      setMessages(prev => [...prev, userMsg]);

      try {
          await window.api.sendMessage(activeContextId, text, activeSystemPrompt);
      } catch (e) {
          setIsProcessing(false);
          console.error(e);
      }
  };

  const handleCreateContext = async () => {
      const session = await window.api.createContext('conversation');
      setContexts(prev => [session, ...prev]);
      setActiveContextId(session.id);
  };

  const handleArchiveContext = async (id: string) => {
      await window.api.deleteContext(id);
      setContexts(prev => prev.filter(c => c.id !== id));
      if (activeContextId === id) setActiveContextId(null);
  };

  const getHeaderProps = (title: string, icon?: React.ReactNode): Omit<HeaderProps, 'children'> => ({
      title, icon, currentView, onNavigate: setCurrentView,
      onToggleTrace: () => setIsTracePanelOpen(prev => !prev),
      isTraceOpen: isTracePanelOpen,
      onOpenSettings: () => setCurrentView('settings'),
      onNavigateToUsers: () => setCurrentView('settings'),
      onMonitor: () => {},
      onLogout: () => {},
      projectName: 'SignalZero Desktop',
      userRole: 'admin',
      userName: 'Desktop User'
  });

  const activeContext = useMemo(() => contexts.find(c => c.id === activeContextId), [activeContextId, contexts]);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-950 font-sans text-gray-900 dark:text-gray-100">
        {currentView === 'chat' && (
            <ContextListPanel 
                contexts={contexts} activeContextId={activeContextId}
                onSelectContext={setActiveContextId} onCreateContext={handleCreateContext}
                onArchiveContext={handleArchiveContext} width={sidebarWidth}
            />
        )}

        <div className="flex-1 flex flex-col min-w-0">
            {currentView === 'settings' ? (
                <SettingsScreen headerProps={getHeaderProps('Settings')} user={user} onLogout={() => {}} />
            ) : (
                <div className="flex flex-col h-full relative">
                    <Header {...getHeaderProps('Kernel', <MessageSquare size={18} className="text-indigo-500" />)} />
                    
                    <div className="flex-1 overflow-y-auto px-4 py-6 scroll-smooth">
                        <div className="max-w-full mx-auto space-y-6 pb-4">
                            {messages.map((msg) => (
                                <ChatMessage key={msg.id} message={msg} onSymbolClick={() => {}} />
                            ))}
                        </div>
                    </div>
                    
                    <ChatInput onSend={handleSendMessage} disabled={isProcessing || !activeContextId} isProcessing={isProcessing} />
                </div>
            )}
        </div>
    </div>
  );
}

export default App;
