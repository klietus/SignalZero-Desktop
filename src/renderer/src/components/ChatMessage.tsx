
import React, { useState } from 'react';
import { Message, Sender } from '../types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Bot, User, Brain, ChevronDown, ChevronUp, Terminal, CheckCircle2, Loader2 } from 'lucide-react';

interface ChatMessageProps {
  message: Message;
  onSymbolClick?: (id: string) => void;
  onTraceClick?: () => void;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message, onSymbolClick, onTraceClick }) => {
  const isAssistant = message.role === Sender.MODEL;
  const isSystem = message.role === Sender.SYSTEM;
  const [showTools, setShowTools] = useState(false);

  const toolExecutions = message.toolCalls || [];

  if (isSystem) {
      return (
          <div className="flex justify-center my-4">
              <div className="bg-gray-900/30 border border-gray-800 rounded-full px-4 py-1 flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-gray-600"></div>
                  <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">{message.content}</span>
              </div>
          </div>
      );
  }

  // 1. Extract and process Thinking Blocks
  let displayContent = message.content || '';
  const thinkingBlocks: string[] = [];
  displayContent = displayContent.replace(/<think>([\s\S]*?)<\/think>/gi, (_, p1) => {
      thinkingBlocks.push(p1.trim());
      return "";
  });

  // 2. Component for rendering text with symbol links
  const TextWithSymbols = ({ text }: { text: string }) => {
      const symbolRegex = /\b(SZ:[A-Z0-9_-]+)\b/g;
      const segments: React.ReactNode[] = [];
      let lastIdx = 0;
      let match;

      while ((match = symbolRegex.exec(text)) !== null) {
          segments.push(text.substring(lastIdx, match.index));
          const id = match[1];
          segments.push(
              <span 
                  key={match.index}
                  onClick={() => onSymbolClick?.(id)}
                  className="text-emerald-400 font-mono font-bold cursor-pointer hover:underline decoration-emerald-500/50 underline-offset-4"
              >
                  {id}
              </span>
          );
          lastIdx = match.index + match[0].length;
      }
      segments.push(text.substring(lastIdx));
      return <>{segments}</>;
  };

  return (
    <div className={`flex flex-col ${isAssistant ? 'items-start' : 'items-end'} w-full group animate-in fade-in slide-in-from-bottom-2 duration-300`}>
      <div className={`flex items-start gap-4 max-w-[85%] ${isAssistant ? 'flex-row' : 'flex-row-reverse'}`}>
        {/* Avatar */}
        <div className={`shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all shadow-xl
            ${isAssistant 
                ? 'bg-indigo-600 text-white group-hover:scale-110' 
                : 'bg-gray-800 text-gray-400 group-hover:scale-110 border border-gray-700'
            }
        `}>
          {isAssistant ? <Bot size={18} /> : <User size={18} />}
        </div>

        {/* Message Container */}
        <div className="flex flex-col space-y-2 min-w-0">
          {/* Tool Traces (TOP) */}
          {isAssistant && toolExecutions.length > 0 && (
              <div className="bg-gray-900/80 border border-gray-800 rounded-2xl overflow-hidden mb-2 shadow-lg">
                  <button 
                    onClick={() => setShowTools(!showTools)}
                    className="w-full flex items-center justify-between px-4 py-2 hover:bg-gray-800/50 transition-colors"
                  >
                      <div className="flex items-center gap-2">
                          <Terminal size={14} className="text-emerald-500" />
                          <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-gray-400">
                              Symbolic_Execution_Traces ({toolExecutions.length})
                          </span>
                      </div>
                      {showTools ? <ChevronUp size={14} className="text-gray-600" /> : <ChevronDown size={14} className="text-gray-600" />}
                  </button>
                  
                  {showTools && (
                      <div className="p-3 border-t border-gray-800 bg-black/40 space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                          {toolExecutions.map((call, i) => (
                              <div key={i} className="space-y-1">
                                  <div className="flex items-center justify-between gap-4">
                                      <div className="flex items-center gap-2 text-[10px] font-mono text-emerald-400">
                                          <div className="w-1 h-1 rounded-full bg-emerald-500"></div>
                                          {call.name}
                                      </div>
                                      {call.result ? <CheckCircle2 size={10} className="text-emerald-500" /> : <Loader2 size={10} className="animate-spin text-gray-600" />}
                                  </div>
                                  <div className="pl-3 border-l border-gray-800">
                                      <pre className="text-[9px] text-gray-500 font-mono overflow-x-auto p-1 bg-gray-900/30 rounded">
                                          {JSON.stringify(call.args, null, 2)}
                                      </pre>
                                      {call.result && (
                                          <pre className="mt-1 text-[9px] text-gray-400 font-mono overflow-x-auto p-1 bg-gray-900/50 rounded max-h-24">
                                              {typeof call.result === 'string' ? call.result : JSON.stringify(call.result, null, 2)}
                                          </pre>
                                      )}
                                  </div>
                              </div>
                          ))}
                      </div>
                  )}
              </div>
          )}

          {/* Bubble */}
          <div className={`p-5 rounded-2xl shadow-2xl relative transition-all
            ${isAssistant 
                ? 'bg-gray-900 border border-gray-800 text-gray-200' 
                : 'bg-indigo-600 text-white border border-indigo-500 shadow-indigo-500/10'
            }
          `}>
            {/* Thinking Sections */}
            {thinkingBlocks.length > 0 && (
                <div className="bg-black/20 border-l-2 border-indigo-500/30 p-3 rounded-r-lg mb-4 space-y-1">
                    <div className="flex items-center gap-2 text-[9px] font-bold text-indigo-400/70 uppercase tracking-widest">
                        <Brain size={10} /> Thought_Process
                    </div>
                    {thinkingBlocks.map((t, i) => (
                        <div key={i} className="text-xs text-gray-500 font-mono italic leading-relaxed">
                            {t}
                        </div>
                    ))}
                </div>
            )}

            <div className={`prose prose-invert max-w-none prose-sm leading-relaxed
                prose-headings:font-light prose-headings:tracking-widest prose-headings:uppercase prose-headings:text-gray-100
                prose-code:text-indigo-300 prose-code:bg-indigo-950/30 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none
                prose-strong:text-white prose-strong:font-bold
                prose-a:text-indigo-400 hover:prose-a:text-indigo-300
                prose-blockquote:border-l-indigo-500/50 prose-blockquote:bg-gray-900/30 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-lg
            `}>
                <ReactMarkdown 
                    remarkPlugins={[remarkGfm]} 
                    rehypePlugins={[rehypeHighlight]}
                    components={{
                        // Custom renderer for text segments to catch symbol tags
                        text: ({ children }) => {
                            if (typeof children !== 'string') return <>{children}</>;
                            return <TextWithSymbols text={children} />;
                        }
                    }}
                >
                    {displayContent}
                </ReactMarkdown>
            </div>
            
            {/* Model & Trace Metadata */}
            {isAssistant && (message.metadata?.model || onTraceClick) && (
                <div className="mt-4 pt-4 border-t border-gray-800/50 flex justify-between items-center">
                    <span className="text-[9px] font-mono text-gray-600 uppercase tracking-widest">
                        {message.metadata?.model || 'Symbolic_Kernel'}
                    </span>
                    {onTraceClick && (
                        <button 
                            onClick={onTraceClick}
                            className="flex items-center gap-1.5 px-2 py-0.5 bg-amber-900/20 hover:bg-amber-900/40 text-amber-500 rounded text-[9px] font-mono font-bold uppercase tracking-widest transition-all"
                        >
                            <Brain size={10} /> View_Trace
                        </button>
                    )}
                </div>
            )}
          </div>

          <div className={`flex items-center gap-2 text-[9px] font-mono text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity ${isAssistant ? 'justify-start' : 'justify-end'}`}>
            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>
    </div>
  );
};
