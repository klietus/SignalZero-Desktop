
import React from 'react';
import {
  Network, ShieldCheck, Activity, MessageSquare, Brain
} from 'lucide-react';

export interface HeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children?: React.ReactNode; 

  currentView: string;
  onNavigate: (view: any) => void;

  onToggleTrace?: () => void;
  isTraceOpen?: boolean;
  onMonitor?: () => void;
  onToggleGraphView?: () => void;
  isGraphView?: boolean;

  projectName?: string;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  subtitle,
  icon,
  children,
  currentView,
  onNavigate,
  onToggleTrace,
  isTraceOpen,
  onMonitor,
  onToggleGraphView,
  isGraphView,
  projectName
}) => {
  return (
    <header className="h-14 bg-gray-950/50 backdrop-blur border-b border-gray-800/50 flex items-center justify-between px-6 z-50 shrink-0 relative">

      <div className="flex items-center gap-4 min-w-0">
        <div className="flex items-center gap-3 min-w-0">
          {icon && <div className="text-gray-400 shrink-0">{icon}</div>}
          <div className="min-w-0">
            <h1 className="text-lg font-light tracking-widest uppercase text-gray-100 flex items-center gap-2 truncate">
              {title}
            </h1>
            {subtitle && <p className="text-[10px] text-gray-500 font-mono uppercase tracking-tighter truncate">{subtitle}</p>}
          </div>
        </div>

        {projectName && (
          <span className="hidden lg:inline-flex items-center gap-1 text-[10px] text-gray-500 font-mono px-2 py-0.5 rounded bg-gray-900 border border-gray-800 ml-4 truncate max-w-[200px]">
            <ShieldCheck size={10} /> {projectName}
          </span>
        )}
      </div>

      <div className="flex items-center gap-4 shrink-0">
        {currentView === 'chat' && onToggleGraphView && (
           <button 
              onClick={onToggleGraphView}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-mono font-bold transition-all ${isGraphView ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'bg-gray-900 text-gray-400 hover:bg-gray-800'}`}
              title={isGraphView ? "Back to Chat" : "Symbolic Graph View"}
            >
              {isGraphView ? <MessageSquare size={14} /> : <Brain size={14} />}
              {isGraphView ? 'Chat' : 'Graph'}
            </button>
        )}

        {currentView !== 'chat' && (
          <button 
            onClick={() => onNavigate('chat')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-mono font-bold transition-all ${currentView === 'chat' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'bg-gray-900 text-gray-400 hover:bg-gray-800'}`}
          >
            <MessageSquare size={14} />
            Chat
          </button>
        )}

        {children && (
          <div className="flex items-center gap-2 border-r border-gray-800 pr-4 mr-2">
            {children}
          </div>
        )}

        <div className="flex items-center gap-1">
          {onMonitor && (
            <button onClick={onMonitor} className="p-2 text-emerald-500 hover:text-emerald-400 hover:bg-emerald-900/20 rounded-lg transition-colors" title="Monitor">
              <Activity size={18} />
            </button>
          )}

          {onToggleTrace && (
            <button
              onClick={onToggleTrace}
              className={`p-2 rounded-lg transition-colors ${isTraceOpen ? 'text-amber-400 bg-amber-900/20' : 'text-gray-500 hover:bg-gray-900'}`}
              title="Toggle Reasoning Trace"
            >
              <Network size={18} />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
