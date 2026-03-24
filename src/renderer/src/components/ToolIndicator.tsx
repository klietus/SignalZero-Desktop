
import React, { useState } from 'react';
import { Terminal, CheckCircle2, CircleDashed, ChevronDown, ChevronRight } from 'lucide-react';
import { ToolCallDetails } from '../types';

interface ToolIndicatorProps {
  toolCalls: ToolCallDetails[];
  isFinished?: boolean;
}

export const ToolIndicator: React.FC<ToolIndicatorProps> = ({ toolCalls, isFinished = false }) => {
  const [expandedCalls, setExpandedCalls] = useState<Record<string, boolean>>({});

  const toggleExpand = (id: string) => {
    setExpandedCalls(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  if (!toolCalls || toolCalls.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 mt-2">
      {toolCalls.map((call, idx) => {
        const callId = call.id || String(idx);
        const isExpanded = expandedCalls[callId];

        return (
          <div
            key={callId}
            className="flex flex-col p-2 text-xs rounded-lg bg-gray-900/50 border border-gray-800/50 max-w-full"
          >
            <div 
                className="flex items-center gap-3 cursor-pointer select-none"
                onClick={() => toggleExpand(callId)}
            >
                <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-md bg-indigo-900/20 text-indigo-400">
                    {isFinished ? (
                    <CheckCircle2 size={12} />
                    ) : (
                    <Terminal size={12} />
                    )}
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-gray-400 uppercase text-[9px] tracking-widest">
                            {call.name.replace(/_/g, ' ')}
                        </span>
                        {!isFinished && <CircleDashed size={10} className="animate-spin text-indigo-500/50"/>}
                    </div>
                    {!isExpanded && (
                        <div className="text-[9px] text-gray-600 font-mono truncate mt-0.5 uppercase tracking-tighter">
                        Payload: {JSON.stringify(call.args)}
                        </div>
                    )}
                </div>

                <div className="text-gray-600">
                    {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </div>
            </div>

            {isExpanded && (
                <div className="mt-3 pl-9 pr-2 pb-1 space-y-3">
                    <div>
                        <div className="text-[8px] font-mono text-gray-600 mb-1 uppercase tracking-[0.2em]">Input_Parameters</div>
                        <pre className="text-[10px] font-mono bg-black/40 p-2 rounded border border-gray-800 whitespace-pre-wrap break-all text-gray-400">
                            {JSON.stringify(call.args, null, 2)}
                        </pre>
                    </div>
                    {call.result && (
                        <div>
                            <div className="text-[8px] font-mono text-emerald-500/50 mb-1 uppercase tracking-[0.2em]">Output_Stream</div>
                            <pre className="text-[10px] font-mono bg-emerald-950/10 p-2 rounded border border-emerald-900/30 whitespace-pre-wrap break-all text-gray-400">
                                {typeof call.result === 'string' ? call.result : JSON.stringify(call.result, null, 2)}
                            </pre>
                        </div>
                    )}
                </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
