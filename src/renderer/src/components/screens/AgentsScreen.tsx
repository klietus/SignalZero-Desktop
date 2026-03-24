import React, { useEffect, useState } from 'react';
import {
    AlertCircle,
    CheckCircle2,
    Clock,
    History,
    Loader2,
    PauseCircle,
    PlayCircle,
    Plus,
    RefreshCcw,
    Trash2,
    Activity,
    Shield,
    Terminal
} from 'lucide-react';
import { AgentDefinition, AgentExecutionLog } from '../../types';
import { Header, HeaderProps } from '../Header';

interface AgentsScreenProps {
    headerProps: Omit<HeaderProps, 'children'>;
}

export const AgentsScreen: React.FC<AgentsScreenProps> = ({ headerProps }) => {
    const [agents, setAgents] = useState<AgentDefinition[]>([]);
    const [logs, setLogs] = useState<AgentExecutionLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Form State
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [newAgentId, setNewAgentId] = useState('');
    const [newAgentPrompt, setNewAgentPrompt] = useState('');
    const [newAgentSchedule, setNewAgentSchedule] = useState('0 * * * *'); // Default: hourly

    const loadData = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [agentList, executionLogs] = await Promise.all([
                window.api.listAgents(),
                window.api.getAgentLogs(undefined, 20)
            ]);
            setAgents(agentList);
            setLogs(executionLogs);
        } catch (err: any) {
            setError(err.message || 'Failed to load agent data');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const handleToggleAgent = async (agent: AgentDefinition) => {
        try {
            await window.api.upsertAgent(agent.id, agent.prompt, !agent.enabled, agent.schedule);
            loadData();
        } catch (err: any) {
            alert('Failed to toggle agent: ' + err.message);
        }
    };

    const handleCreateAgent = async () => {
        if (!newAgentId || !newAgentPrompt) return;
        setIsSaving(true);
        try {
            await window.api.upsertAgent(newAgentId, newAgentPrompt, true, newAgentSchedule);
            setNewAgentId('');
            setNewAgentPrompt('');
            setIsCreateModalOpen(false);
            loadData();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteAgent = async (id: string) => {
        if (!window.confirm(`Are you sure you want to delete agent "${id}"?`)) return;
        try {
            await window.api.deleteAgent(id);
            loadData();
        } catch (err: any) {
            alert('Failed to delete agent: ' + err.message);
        }
    };

    return (
        <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950 font-sans">
            <Header {...headerProps} title="Autonomous Agents" subtitle="Background Reasoning & Automation">
                <div className="flex items-center gap-2">
                    <button onClick={loadData} className="p-2 text-gray-500 hover:text-indigo-500 transition-colors">
                        <RefreshCcw size={18} className={isLoading ? 'animate-spin' : ''} />
                    </button>
                    <button
                        onClick={() => setIsCreateModalOpen(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-sm font-bold font-mono transition-all"
                    >
                        <Plus size={16} /> New Agent
                    </button>
                </div>
            </Header>

            <div className="flex-1 overflow-y-auto p-8">
                <div className="max-w-6xl mx-auto space-y-8">
                    {error && (
                        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm font-mono flex items-center gap-3">
                            <AlertCircle size={18} /> {error}
                        </div>
                    )}

                    {/* Active Agents Grid */}
                    <section className="space-y-4">
                        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 font-mono flex items-center gap-2">
                            <Activity size={14} /> Active Agent Registry
                        </h3>
                        
                        {agents.length === 0 && !isLoading ? (
                            <div className="text-center py-12 bg-white dark:bg-gray-900 rounded-xl border border-dashed border-gray-200 dark:border-gray-800 text-gray-400 font-mono text-sm">
                                No agents configured. Create one to start background processing.
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {agents.map((agent) => (
                                    <div key={agent.id} className={`p-6 rounded-xl border transition-all ${agent.enabled ? 'bg-white dark:bg-gray-900 border-indigo-500/30 shadow-sm' : 'bg-gray-100 dark:bg-gray-900/50 border-gray-200 dark:border-gray-800 opacity-75'}`}>
                                        <div className="flex justify-between items-start mb-4">
                                            <div>
                                                <h4 className="font-bold font-mono text-lg text-gray-900 dark:text-gray-100">{agent.id}</h4>
                                                <div className="flex items-center gap-3 mt-1">
                                                    <span className="flex items-center gap-1 text-[10px] font-mono text-gray-500">
                                                        <Clock size={12} /> {agent.schedule || 'Manual Only'}
                                                    </span>
                                                    {agent.lastRunAt && (
                                                        <span className="text-[10px] font-mono text-emerald-500 flex items-center gap-1">
                                                            <CheckCircle2 size={12} /> Last run: {new Date(agent.lastRunAt).toLocaleTimeString()}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => handleToggleAgent(agent)}
                                                    className={`p-2 rounded-lg transition-colors ${agent.enabled ? 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'text-gray-400 bg-gray-100 dark:bg-gray-800'}`}
                                                    title={agent.enabled ? 'Pause Agent' : 'Activate Agent'}
                                                >
                                                    {agent.enabled ? <PauseCircle size={20} /> : <PlayCircle size={20} />}
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteAgent(agent.id)}
                                                    className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                                                    title="Delete Agent"
                                                >
                                                    <Trash2 size={20} />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="p-4 bg-gray-50 dark:bg-gray-950 rounded-lg border border-gray-100 dark:border-gray-800 mb-4">
                                            <div className="text-[10px] font-bold text-gray-400 uppercase mb-2 font-mono">System Prompt</div>
                                            <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-3 font-mono leading-relaxed italic">
                                                "{agent.prompt}"
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    {/* Execution Logs */}
                    <section className="space-y-4">
                        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 font-mono flex items-center gap-2">
                            <History size={14} /> Global Execution Audit
                        </h3>
                        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
                            <table className="w-full text-left text-xs font-mono">
                                <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
                                    <tr>
                                        <th className="px-6 py-3 font-bold text-gray-500 uppercase tracking-wider">Timestamp</th>
                                        <th className="px-6 py-3 font-bold text-gray-500 uppercase tracking-wider">Agent ID</th>
                                        <th className="px-6 py-3 font-bold text-gray-500 uppercase tracking-wider">Status</th>
                                        <th className="px-6 py-3 font-bold text-gray-500 uppercase tracking-wider text-right">Traces</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                    {logs.length === 0 ? (
                                        <tr>
                                            <td colSpan={4} className="px-6 py-12 text-center text-gray-400 italic">No execution history recorded yet.</td>
                                        </tr>
                                    ) : (
                                        logs.map((log) => (
                                            <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                                                <td className="px-6 py-4 text-gray-500">{new Date(log.startedAt).toLocaleString()}</td>
                                                <td className="px-6 py-4 font-bold text-indigo-600 dark:text-indigo-400">{log.agentId}</td>
                                                <td className="px-6 py-4">
                                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                                        log.status === 'completed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30' :
                                                        log.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-900/30' :
                                                        'bg-amber-100 text-amber-700 dark:bg-amber-900/30 animate-pulse'
                                                    }`}>
                                                        {log.status}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-right text-gray-400">{log.traceCount}</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </section>
                </div>
            </div>

            {/* Create Modal */}
            {isCreateModalOpen && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-2xl w-full p-8 border border-gray-200 dark:border-gray-800">
                        <h3 className="text-lg font-bold font-mono text-gray-900 dark:text-white mb-6 flex items-center gap-3">
                            <Plus size={20} className="text-indigo-500" /> Deploy New Agent
                        </h3>
                        
                        <div className="space-y-6">
                            <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono">Agent Identifier</label>
                                    <input 
                                        type="text" 
                                        value={newAgentId}
                                        onChange={(e) => setNewAgentId(e.target.value)}
                                        placeholder="e.g. daily-summary-node"
                                        className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-2 text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono">Cron Schedule</label>
                                    <input 
                                        type="text" 
                                        value={newAgentSchedule}
                                        onChange={(e) => setNewAgentSchedule(e.target.value)}
                                        placeholder="0 * * * * (Hourly)"
                                        className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-2 text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono">System Directive</label>
                                <textarea 
                                    value={newAgentPrompt}
                                    onChange={(e) => setNewAgentPrompt(e.target.value)}
                                    placeholder="Define the recursive goals and constraints for this agent..."
                                    className="w-full h-40 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none"
                                />
                            </div>
                        </div>

                        <div className="flex gap-3 justify-end mt-8 pt-6 border-t border-gray-100 dark:border-gray-800">
                            <button
                                onClick={() => setIsCreateModalOpen(false)}
                                className="px-6 py-2 text-sm font-mono text-gray-500 hover:text-gray-700 transition-colors"
                            >
                                Discard
                            </button>
                            <button
                                onClick={handleCreateAgent}
                                disabled={isSaving || !newAgentId || !newAgentPrompt}
                                className="flex items-center gap-2 px-6 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-sm font-bold font-mono transition-all shadow-md shadow-indigo-500/20"
                            >
                                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Shield size={16} />}
                                Initialize & Deploy
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
