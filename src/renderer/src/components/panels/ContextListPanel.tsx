import React from 'react';
import { Plus, Archive, MessageSquare, Hash, Zap } from 'lucide-react';
import { ContextSession } from '../../types';

interface ContextListPanelProps {
  contexts: ContextSession[];
  activeContextId: string | null;
  onSelectContext: (id: string) => void;
  onCreateContext: () => void;
  onArchiveContext: (id: string) => void;
  width?: number;
}

export const ContextListPanel: React.FC<ContextListPanelProps> = ({
  contexts,
  activeContextId,
  onSelectContext,
  onCreateContext,
  onArchiveContext,
  width = 256
}) => {
  const activeContexts = contexts.filter(c => c.status === 'open');
  const conversations = activeContexts.filter(c => c.type === 'conversation');
  const agentContexts = activeContexts.filter(c => c.type === 'agent');

  const renderContextItem = (ctx: ContextSession) => (
    <div
      key={ctx.id}
      className={`group relative flex items-center justify-between p-2 rounded-lg cursor-pointer text-xs transition-all duration-200 ${activeContextId === ctx.id
        ? 'bg-gray-800 text-indigo-400 font-medium ring-1 ring-gray-700'
        : 'hover:bg-gray-900 text-gray-400 hover:text-gray-200'
        }`}
      onClick={() => onSelectContext(ctx.id)}
    >
      <div className="flex items-center gap-2 overflow-hidden w-full">
        <MessageSquare size={14} className={`flex-shrink-0 ${activeContextId === ctx.id ? 'text-indigo-400' : 'text-gray-600'}`} />
        <div className="flex flex-col min-w-0 flex-1">
          <span className="truncate font-mono pr-6">{ctx.name || ctx.id}</span>
          <span className="text-[10px] text-gray-600 truncate uppercase tracking-tighter">
            {new Date(ctx.createdAt).toLocaleTimeString()}
          </span>
        </div>
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onArchiveContext(ctx.id);
        }}
        className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1.5 bg-gray-800/80 backdrop-blur-sm hover:bg-red-900/40 text-gray-500 hover:text-red-400 rounded transition-all z-10"
        title="Archive"
      >
        <Archive size={12} />
      </button>
    </div>
  );

  return (
    <div
      className="bg-gray-950/70 backdrop-blur-md border-r border-gray-800/50 flex flex-col h-full overflow-hidden flex-shrink-0 relative z-10"
      style={{ width: `${width}px` }}
    >
      <div className="p-4 flex items-center justify-between">
        <h2 className="font-light text-[10px] text-gray-500 uppercase tracking-[0.2em]">Contexts</h2>
        <button
          onClick={onCreateContext}
          className="p-1 hover:bg-gray-900 text-gray-400 hover:text-indigo-400 rounded transition-all"
          title="New Context"
        >
          <Plus size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-6">
        {/* User Conversations Section */}
        <section className="space-y-1">
          <div className="px-2 mb-2 flex items-center gap-2 text-[9px] font-bold text-gray-600 uppercase tracking-widest">
            <Hash size={10} />
            <span>Conversations</span>
          </div>
          {conversations.length === 0 && (
            <div className="px-2 py-8 text-gray-700 text-[10px] font-mono border border-dashed border-gray-900 rounded-lg text-center" >
              NO_ACTIVE_SESSIONS
            </div>
          )}
          {conversations.map(renderContextItem)}
        </section>

        {/* Agent / Async Section */}
        {agentContexts.length > 0 && (
          <section className="space-y-1 pt-4">
            <div className="px-2 mb-2 flex items-center gap-2 text-[9px] font-bold text-gray-600 uppercase tracking-widest border-t border-gray-900 pt-4">
              <Zap size={10} />
              <span>Autonomous</span>
            </div>
            {agentContexts.map(ctx => {
              const agentName = ctx.metadata?.agentId || "Background";
              return (
                <div key={ctx.id} className="space-y-1">
                  <div className="px-2 py-0.5 text-[8px] font-mono text-indigo-500/40 uppercase truncate">
                    [{agentName}]
                  </div>
                  {renderContextItem(ctx)}
                </div>
              );
            })}
          </section>
        )}
      </div>

    </div>
  );
};
