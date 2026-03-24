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
            className="flex flex-col p-2 text-xs rounded-md bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 max-w-full animate-in fade-in slide-in-from-bottom-2 duration-300"
          >
            <div 
                className="flex items-center gap-3 cursor-pointer select-none"
                onClick={() => toggleExpand(callId)}
            >
                <div className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                    {isFinished ? (
                    <CheckCircle2 size={14} />
                    ) : (
                    <Terminal size={14} />
                    )}
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-700 dark:text-gray-200 truncate">
                            {call.name.replace(/_/g, ' ')}
                        </span>
                        {!isFinished && <CircleDashed size={12} className="animate-spin text-gray-400"/>}
                    </div>
                    {!isExpanded && (
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 font-mono truncate mt-0.5">
                        Arguments: {JSON.stringify(call.args)}
                        </div>
                    )}
                </div>

                <div className="text-gray-400">
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </div>
            </div>

            {isExpanded && (
                <div className="mt-2 pl-10 pr-2 pb-1 overflow-x-auto space-y-3">
                    <div>
                        <div className="text-[10px] font-mono text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Arguments</div>
                        <pre className="text-[11px] font-mono bg-gray-50 dark:bg-gray-900 p-2 rounded border border-gray-200 dark:border-gray-700 whitespace-pre-wrap break-all">
                            {JSON.stringify(call.args, null, 2)}
                        </pre>
                    </div>
                    {call.result && (
                        <div>
                            <div className="text-[10px] font-mono text-emerald-600 dark:text-emerald-500 mb-1 uppercase tracking-wider">Result</div>
                            <pre className="text-[11px] font-mono bg-emerald-50/50 dark:bg-emerald-900/10 p-2 rounded border border-emerald-100 dark:border-emerald-900/30 whitespace-pre-wrap break-all text-gray-700 dark:text-gray-300">
                                {call.result}
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