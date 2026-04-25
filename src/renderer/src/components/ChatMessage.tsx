
import React, { useState, useMemo } from 'react';
import { User, Terminal, Network, ChevronDown, ChevronRight, Activity, Copy, RotateCcw, Paperclip } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sender, TraceData } from '../types';
import { ToolIndicator } from './ToolIndicator';

interface Message {
    id: string;
    role: Sender;
    content: string;
    timestamp: Date;
    isStreaming?: boolean;
    toolCalls?: any[];
    correlationId?: string;
    toolCallId?: string | null;
    metadata?: Record<string, any>;
}

interface ChatMessageProps {
  message: Message;
  onSymbolClick?: (id: string, data?: any) => void;
  onDomainClick?: (domain: string) => void;
  onTraceClick?: (id?: string) => void;
   onRetry?: (messageId: string, text: string) => void;
  isVisible?: boolean;
}

// --- Helper for Unicode Decoding ---
const decodeUnicode = (str: string) => {
  if (!str) return str;
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
};

// --- Shared UI Components ---

interface SymbolTagProps {
  id: string;
  name?: string;
  onClick?: (id: string) => void;
}

const SymbolTag: React.FC<SymbolTagProps> = ({ id, name, onClick }) => {
  const displayId = typeof id === 'object' ? JSON.stringify(id) : String(id);
  return (
    <button 
        onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (onClick) onClick(displayId);
        }}
        className="inline-flex items-center gap-1.5 px-1.5 py-0.5 mx-0.5 rounded-md text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors font-mono text-[10px] md:text-xs cursor-pointer select-none align-middle shadow-sm"
        title={name ? `Symbol: ${name} (${displayId})` : `Symbol: ${displayId}`}
    >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0"></span>
        <span className="font-semibold">{displayId}</span>
        {name && (
            <span className="opacity-75 inline-block border-l border-emerald-500/30 pl-1.5 ml-0.5 max-w-[200px] truncate">
                {name}
            </span>
        )}
    </button>
  );
};

interface DomainTagProps {
  id: string;
  name?: string;
  onClick?: (id: string) => void;
}

const DomainTag: React.FC<DomainTagProps> = ({ id, name, onClick }) => {
  const displayName = name && name !== id ? `${name} (${id})` : id;
  return (
    <button 
        onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (onClick) onClick(id);
        }}
        className="inline-flex items-center gap-1.5 px-1.5 py-0.5 mx-0.5 rounded-md text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors font-mono text-[10px] md:text-xs cursor-pointer select-none align-middle shadow-sm"
        title={`Domain: ${displayName}`}
    >
        <span className="font-semibold">{displayName}</span>
    </button>
  );
};

const TraceAggregator: React.FC<{ traces: TraceData[], onTraceClick?: (id: string) => void, defaultExpanded?: boolean }> = ({ traces, onTraceClick, defaultExpanded = false }) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (!traces || traces.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/10 overflow-hidden">
      <button 
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-2 text-xs font-mono font-bold text-amber-700 dark:text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-900/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Network size={14} />
          <span>{traces.length} Reasoning Trace{traces.length !== 1 ? 's' : ''} Captured</span>
        </div>
        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      {isExpanded && (
        <div className="border-t border-amber-200 dark:border-amber-900/50 divide-y divide-amber-200/50 dark:divide-amber-900/30">
          {(traces || []).map((trace, idx) => (
            <button
              key={idx}
              onClick={() => trace?.id && onTraceClick && onTraceClick(trace.id)}
              className="w-full text-left px-4 py-3 hover:bg-amber-100/50 dark:hover:bg-amber-900/30 transition-colors group"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-[10px] text-amber-600/70 dark:text-amber-500/70">{trace?.id || 'N/A'}</span>
                <span className="flex items-center gap-1 text-[10px] uppercase text-amber-600 dark:text-amber-400 font-bold bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded">
                  <Activity size={10} /> {trace?.status || 'UNKNOWN'}
                </span>
              </div>
              <div className="text-xs text-gray-700 dark:text-gray-300 font-mono line-clamp-1">
                <span className="text-gray-400">Entry:</span> {trace?.entry_node || 'N/A'}
              </div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 truncate">
                 via {trace?.activated_by || 'Unknown'}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const ThinkingBlock: React.FC<{ content: string }> = ({ content }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  return (
    <div className="my-4 rounded-lg border border-purple-200 dark:border-purple-900/50 bg-purple-50 dark:bg-purple-900/10 overflow-hidden">
        <button 
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full flex items-center justify-between px-4 py-2 text-xs font-mono font-bold text-purple-700 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/20 transition-colors"
        >
            <div className="flex items-center gap-2">
                <Activity size={14} />
                <span>Thinking Process</span>
            </div>
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        {isExpanded && (
            <div className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300 font-mono whitespace-pre-wrap border-t border-purple-200 dark:border-purple-900/50 bg-white/50 dark:bg-black/20">
                {content}
            </div>
        )}
    </div>
  );
};

export const ChatMessage: React.FC<ChatMessageProps> = ({ message, onSymbolClick, onDomainClick, onTraceClick, onRetry, isVisible = true }) => {
  const isUser = message.role === Sender.USER;
  const isAssistantResponse = message.role !== Sender.USER;
  const [showToolList, setShowToolList] = useState(false);
  const [showTraceList, setShowTraceList] = useState(false);
  const [copyLabel, setCopyLabel] = useState('Copy');

  // Extract traces and clean content
  const { traces, contentWithoutTraces } = useMemo(() => {
    const extractedTraces: TraceData[] = [];
    let cleanContent = message.content.replace(/<sz_trace>([\s\S]*?)<\/sz_trace>/g, (_, inner) => {
      try {
        const cleanJson = inner.replace(/```json\n?|```/g, '').trim();
        const data: TraceData = JSON.parse(cleanJson);
        extractedTraces.push(data);
      } catch (e) {
        console.warn("[ChatMessage] Partial or invalid trace detected during render parsing:", e);
      }
      return ''; // Remove trace block from text
    });

    // Strip attachments marker and everything after it for user messages in UI
    if (isUser) {
        // Remove XML attachment block
        cleanContent = cleanContent.replace(/<attachments>[\s\S]*?<\/attachments>/g, '').trim();

        const attachmentsMarker = "--- Attachments ---";
        const markerIndex = cleanContent.indexOf(attachmentsMarker);
        if (markerIndex !== -1) {
            // Also try to strip the preceding newlines
            cleanContent = cleanContent.substring(0, markerIndex).trim();
        }
    }

    return { traces: extractedTraces, contentWithoutTraces: cleanContent };
  }, [message.content, isUser]);

  const handleCopy = async () => {
    const textToCopy = contentWithoutTraces || message.content;
    if (!textToCopy) return;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(textToCopy);
        setCopyLabel('Copied');
        setTimeout(() => setCopyLabel('Copy'), 1500);
      } else {
        throw new Error('Clipboard API not available');
      }
    } catch (err) {
      console.error('Copy failed:', err);
      // Fallback to execCommand
      try {
        const textArea = document.createElement('textarea');
        textArea.value = textToCopy;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setCopyLabel('Copied');
        setTimeout(() => setCopyLabel('Copy'), 1500);
      } catch (fallbackErr) {
        setCopyLabel('Copy failed');
        setTimeout(() => setCopyLabel('Copy'), 2000);
      }
    }
  };

  // ... existing copy logic ...
  
  const cleanContent = (text: string) => {
    if (!text) return "";
    return text
      .replace(/\[\d{2}:\d{2}:\d{2}\]\s*/g, '') // Hide timestamps
      // Hide emotion/voice tags (lowercase, simple words) while preserving complex structural tags
      .replace(/<(?:neutral|emphatic|whispering\/calm|happy|sad|angry|fearful|disgust|surprise|focused|blinking|excited\/loud)>\s*/gi, '')
      .trim();
  };

  // Formatter to handle code blocks and Markdown text (with integrated sz tags)
  const formatText = (text: string) => {
    // Split ONLY by Code Blocks to isolate them
    const parts = text.split(/(`{3}[\s\S]*?`{3})/g);
    
    return parts.map((part, i) => {
      // 1. Handle Code Blocks
      if (part.startsWith('```') && part.endsWith('```')) {
        const content = part.slice(3, -3).replace(/^[a-z]+\n/, ''); // remove lang tag
        return (
          <div key={i} className="my-3 p-3 bg-gray-950/80 backdrop-blur-sm border border-gray-800/50 text-gray-300 rounded text-xs md:text-sm font-mono overflow-x-auto shadow-inner">
            {content}
          </div>
        );
      }

      // 2. Handle Markdown and integrated custom tags
      let markdownContent = part;
      
      // MASK TIMESTAMPS AND TAGS FOR UI DISPLAY
      markdownContent = cleanContent(markdownContent);

      // Handle <think> tags (convert to a format ReactMarkdown component can catch)
      markdownContent = markdownContent.replace(/<(?:seed:)?think>([\s\S]*?)<\/(?:seed:)?think>/g, (_, content) => {
          return `[${content.trim()}](sz-think:thinking)`;
      });

      // Handle <sz_id> tags
      markdownContent = markdownContent.replace(/<sz_id>(.*?)<\/sz_id>/g, '[$1](sz:$1)');

      // Handle <sz_symbol> tags
      markdownContent = markdownContent.replace(/<sz_symbol>([\s\S]*?)<\/sz_symbol>/g, (_, inner) => {
          const cleanJson = inner.replace(/```json\n?|```/g, '').trim();
          try {
              const data = JSON.parse(cleanJson);
              const label = data.name || data.id || "Symbol";
              const payload = btoa(unescape(encodeURIComponent(cleanJson)));
              return `[${label}](sz-symbol:${payload})`;
          } catch (e) {
              return `[Malformed Symbol](sz-error:invalid-json)`;
          }
      });

      // Handle <sz_domain> tags
      markdownContent = markdownContent.replace(/<sz_domain>([\s\S]*?)<\/sz_domain>/g, (_, inner) => {
          const cleanJson = inner.replace(/```json\n?|```/g, '').trim();
          try {
              const data = JSON.parse(cleanJson);
              const label = data.name || data.domain_id || "Domain";
              const payload = btoa(unescape(encodeURIComponent(cleanJson)));
              return `[${label}](sz-domain:${payload})`;
          } catch (e) {
              return `[Malformed Domain](sz-error:invalid-json)`;
          }
      });
      
      // Decode unicode escapes in the text content
      markdownContent = decodeUnicode(markdownContent);

      return (
        <div key={i} className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-gray-950/80 prose-pre:backdrop-blur-sm prose-pre:border prose-pre:border-gray-800/50">
           <ReactMarkdown
             remarkPlugins={[remarkGfm]}
             components={{
                a: ({href, children, ...props}: any) => {
                    if (!href) return null;

                    // 1. Thinking Block
                    if (href.startsWith('sz-think:')) {
                        const content = children?.[0] || "";
                        return <ThinkingBlock content={String(content)} />;
                    }

                    // 2. Symbol Tag
                    if (href.startsWith('sz-symbol:')) {
                        try {
                            const b64 = href.replace(/^sz-symbol:/, '');
                            const jsonStr = decodeURIComponent(escape(atob(b64)));
                            const data = JSON.parse(jsonStr);
                            return (
                                <div className="block my-1">
                                    <SymbolTag 
                                        id={data.id} 
                                        name={data.name} 
                                        onClick={(clickId) => onSymbolClick && onSymbolClick(clickId, data)} 
                                    />
                                </div>
                            );
                        } catch (e) {
                            return <span className="text-red-500">[Invalid Symbol Data]</span>;
                        }
                    }

                    // 3. Domain Tag
                    if (href.startsWith('sz-domain:')) {
                        try {
                            const b64 = href.replace(/^sz-domain:/, '');
                            const jsonStr = decodeURIComponent(escape(atob(b64)));
                            const data = JSON.parse(jsonStr);
                            return (
                                <div className="block my-1">
                                    <DomainTag id={data.domain_id} name={data.name} onClick={onDomainClick} />
                                </div>
                            );
                        } catch (e) {
                            return <span className="text-red-500">[Invalid Domain Data]</span>;
                        }
                    }

                    // 4. Legacy sz: protocol
                    if (href.startsWith('sz:')) {
                        const id = href.replace(/^sz:/, '');
                        return (
                            <div className="block my-1">
                                <SymbolTag id={id} onClick={(clickId) => onSymbolClick && onSymbolClick(clickId)} />
                            </div>
                        );
                    }

                    // Standard external link
                    return <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline" {...props}>{children}</a>;
                },
                code: ({node, className, children, ...props}: any) => {
                    const isBlock = /language-/.test(className || '');
                    return (
                        <code className={`${isBlock ? '' : 'bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded font-mono text-sm before:content-[""] after:content-[""]'}`} {...props}>
                            {children}
                        </code>
                    );
                },
                p: ({children}: any) => (
                    <div className="block whitespace-pre-wrap leading-relaxed mb-4 last:mb-0">{children}</div>
                ),
                ul: ({children}: any) => (
                    <ul className="block p-0 m-0 ml-6 list-disc">{children}</ul>
                ),
                ol: ({children}: any) => (
                    <ol className="block p-0 m-0 ml-6 list-decimal">{children}</ol>
                ),
                li: ({children}: any) => (
                    <li className="mb-1 last:mb-0">{children}</li>
                ),
                hr: () => (
                    <hr className="my-2 border-gray-200 dark:border-gray-800" />
                ),
                img: ({src, alt}: any) => (
                    <div className="my-4 block">
                        <img 
                            src={src} 
                            alt={alt} 
                            className="max-w-full h-auto rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-md transition-shadow cursor-zoom-in"
                            onClick={() => window.open(src, '_blank')}
                        />
                        {alt && <span className="block mt-1.5 text-[10px] text-gray-400 italic text-center">{alt}</span>}
                    </div>
                )
             }}
           >
             {markdownContent}
           </ReactMarkdown>
       </div>
      );
    });
  };

  return (
    <div className={`flex w-full mb-6 pointer-events-none ${isUser ? 'justify-end' : 'justify-start'} ${!isVisible ? 'opacity-0' : ''}`}>
      <div className={`flex max-w-[90%] md:max-w-[80%] gap-3 pointer-events-none ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        
        {/* Avatar */}
        <div className="flex flex-col items-center gap-1">
            <div className={`flex-shrink-0 w-8 h-8 rounded flex items-center justify-center shadow-sm border
              ${isVisible ? 'pointer-events-auto' : 'pointer-events-none'}
              ${isUser 
                ? 'bg-indigo-600 border-indigo-500 text-white' 
                : 'bg-gray-900 border-gray-700 text-emerald-500'
              }`}>
              {isUser ? <User size={16} /> : <Terminal size={16} />}
            </div>
            {isUser && message.metadata?.voice_authenticated_username && (
                <div className="text-[8px] font-bold uppercase text-indigo-500 bg-indigo-500/10 px-1 rounded truncate max-w-[40px] text-center">
                    {message.metadata.voice_authenticated_username}
                </div>
            )}
        </div>

        {/* Bubble */}
        <div className={`flex flex-col items-start ${isUser ? 'items-end' : 'items-start'} w-fit min-w-0 pointer-events-none`}>
          <div className={`relative px-4 py-3 rounded-lg shadow-sm text-base leading-relaxed w-fit
            ${isVisible ? 'pointer-events-auto' : 'pointer-events-none'}
            ${isUser 
              ? 'bg-indigo-600/80 backdrop-blur-md border border-indigo-500/30 text-white' 
              : 'bg-white/80 dark:bg-gray-900/80 backdrop-blur-md text-gray-800 dark:text-gray-300 border border-gray-200/50 dark:border-gray-800/50'
            }`}>
            
            {/* Header / Meta Controls */}
            {isUser && (
                <div className={`flex items-center gap-2 mb-2 pb-2 border-b border-white/20 w-full ${message.metadata?.attachments && message.metadata.attachments.length > 0 ? 'justify-between' : 'justify-end'}`}>
                    {message.metadata?.attachments && message.metadata.attachments.length > 0 && (
                        <div className="flex items-center gap-2 text-xs font-mono opacity-90">
                            <Paperclip size={12} />
                            <span>{message.metadata.attachments.length} Attachment{message.metadata.attachments.length !== 1 ? 's' : ''}</span>
                        </div>
                    )}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => onRetry && onRetry(message.id, message.content)}
                            className="p-1 rounded text-indigo-200 hover:text-white hover:bg-white/10 transition-colors"
                            title="Retry message"
                        >
                            <RotateCcw size={14} />
                        </button>
                        <button
                            onClick={handleCopy}
                            className={`p-1 rounded transition-colors ${copyLabel === 'Copied' ? 'text-white' : 'text-indigo-200 hover:text-white hover:bg-white/10'}`}
                            title={copyLabel}
                        >
                            <Copy size={14} />
                        </button>
                    </div>
                </div>
            )}

            {isAssistantResponse && (
              <div className="flex items-center justify-between gap-4 mb-3 pb-2 border-b border-gray-100 dark:border-gray-800 w-full">
                {/* Left: Tool Toggle */}
                <div className="flex-1 min-w-0">
                  {message.toolCalls && message.toolCalls.length > 0 && (
                    <div 
                        className="text-[10px] uppercase font-bold text-gray-400 flex items-center gap-1 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300 transition-colors select-none truncate" 
                        onClick={() => setShowToolList(prev => !prev)}
                    >
                        <Terminal size={10} className="flex-shrink-0" />
                        <span>{message.toolCalls.length} Tool Execution{message.toolCalls.length !== 1 ? 's' : ''}</span>
                        {showToolList ? <ChevronDown size={10} className="flex-shrink-0" /> : <ChevronRight size={10} className="flex-shrink-0" />}
                    </div>
                  )}
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {traces.length > 0 && (
                    <button
                      onClick={() => setShowTraceList(prev => !prev)}
                      className="relative flex items-center justify-center w-6 h-6 rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-100 dark:border-amber-800 hover:border-amber-200 dark:hover:border-amber-700 transition-colors"
                      title="View reasoning traces"
                    >
                      <Network size={12} />
                      {traces.length > 1 && (
                        <span className="absolute -top-1 -right-1 text-[8px] leading-none px-1.5 py-0.5 rounded-full bg-amber-600 text-white shadow">
                          {traces.length}
                        </span>
                      )}
                    </button>
                  )}

                  {!message.isStreaming && message.content && (
                    <>
                      <button
                        onClick={() => onRetry && onRetry(message.id, message.content)}
                        className="p-1 rounded-md text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                        title="Retry message"
                      >
                        <RotateCcw size={14} />
                      </button>
                      <button
                        onClick={handleCopy}
                        className={`p-1 rounded-md transition-colors ${copyLabel === 'Copied' ? 'text-emerald-500' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                        title={copyLabel}
                      >
                        <Copy size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Expanded Tool List */}
            {isAssistantResponse && showToolList && message.toolCalls && message.toolCalls.length > 0 && (
               <div className="mb-3 w-full border-b border-gray-100 dark:border-gray-800 pb-2">
                 <ToolIndicator toolCalls={message.toolCalls} isFinished={!message.isStreaming || message.content.length > 0} />
               </div>
            )}

            {/* Trace Visualizer */}
            {showTraceList && (
              <TraceAggregator traces={traces} onTraceClick={(id) => onTraceClick && onTraceClick(id)} defaultExpanded />
            )}

            {/* Message Content or Pulse */}
            {isAssistantResponse && message.isStreaming && !message.content ? (
                <div className="flex items-center gap-2 py-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse delay-75"></span>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse delay-150"></span>
                </div>
            ) : (
                <div className={`max-w-full break-words`}>
                    {formatText(contentWithoutTraces)}
                    {message.isStreaming && (
                        <span className="inline-block w-2 h-4 ml-1 align-middle bg-emerald-500 opacity-75 animate-pulse" />
                    )}
                </div>
            )}
          </div>
          
          <div className={`text-[10px] text-gray-400 dark:text-gray-600 mt-1 px-1 font-mono ${isVisible ? 'pointer-events-auto' : 'pointer-events-none'}`}>
            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>

      </div>
    </div>
  );
};
