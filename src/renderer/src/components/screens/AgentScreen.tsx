import React, { useState, useEffect } from 'react';
import { 
    Plus, Trash2, Save, 
    Activity, Clock, Hash, CheckCircle2, 
    XCircle, Loader2, ChevronRight,
    Terminal, Settings2, Sparkles
} from 'lucide-react';
import { Header, HeaderProps } from '../Header';
import { AgentDefinition, AgentExecutionLog } from '../../types';

interface AgentScreenProps {
    headerProps: HeaderProps;
}

export const AgentScreen: React.FC<AgentScreenProps> = ({ headerProps }) => {
    const [agents, setAgents] = useState<AgentDefinition[]>([]);
    const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
    const [logs, setLogs] = useState<AgentExecutionLog[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);

    // Form State
    const [editId, setEditId] = useState('');
    const [editPrompt, setEditPrompt] = useState('');
    const [editSchedule, setEditSchedule] = useState('');
    const [editEnabled, setEditEnabled] = useState(true);
    const [editSubscriptions, setEditSubscriptions] = useState<string[]>([]);
    const [newSub, setNewSub] = useState('');

    const loadAgents = async () => {
        setIsLoading(true);
        try {
            const list = await window.api.listAgents();
            setAgents(list);
            if (list.length > 0 && !selectedAgentId) {
                selectAgent(list[0]);
            }
        } catch (error) {
            console.error("Failed to load agents", error);
        } finally {
            setIsLoading(false);
        }
    };

    const selectAgent = (agent: AgentDefinition) => {
        setSelectedAgentId(agent.id);
        setEditId(agent.id);
        setEditPrompt(agent.prompt);
        setEditSchedule(agent.schedule || '');
        setEditEnabled(agent.enabled);
        setEditSubscriptions(agent.subscriptions || []);
        
        // Load logs
        window.api.getAgentLogs(agent.id, 20).then(setLogs).catch(() => {});
    };

    const handleCreateNew = () => {
        const newId = `agent-${Date.now().toString(36)}`;
        setSelectedAgentId(newId);
        setEditId(newId);
        setEditPrompt('');
        setEditSchedule('');
        setEditEnabled(true);
        setEditSubscriptions([]);
        setLogs([]);
    };

    const handleSave = async () => {
        if (!editId.trim()) return;
        setIsSaving(true);
        try {
            await window.api.upsertAgent(editId, editPrompt, editEnabled, editSchedule, editSubscriptions);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 2000);
            await loadAgents();
        } catch (error) {
            console.error("Failed to save agent", error);
            alert("Failed to save agent");
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm(`Are you sure you want to delete agent ${id}?`)) return;
        try {
            await window.api.deleteAgent(id);
            if (selectedAgentId === id) setSelectedAgentId(null);
            await loadAgents();
        } catch (error) {
            console.error("Delete failed", error);
        }
    };

    const addSubscription = () => {
        if (!newSub.trim()) return;
        if (!editSubscriptions.includes(newSub.trim())) {
            setEditSubscriptions([...editSubscriptions, newSub.trim()]);
        }
        setNewSub('');
    };

    const removeSubscription = (sub: string) => {
        setEditSubscriptions(editSubscriptions.filter(s => s !== sub));
    };

    useEffect(() => {
        loadAgents();
    }, []);

    return (
        <div className="flex flex-col h-full bg-gray-950 font-sans text-gray-200">
            <Header {...headerProps}>
                <button 
                    onClick={handleCreateNew}
                    className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs font-mono font-bold transition-colors"
                >
                    <Plus size={14} /> New Agent
                </button>
            </Header>

            <div className="flex-1 flex min-h-0 overflow-hidden">
                {/* Agent List Sidebar */}
                <div className="w-80 border-r border-gray-800 flex flex-col bg-gray-900/20">
                    <div className="p-4 border-b border-gray-800 flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 font-mono">Registry</span>
                        <Activity size={14} className="text-gray-600" />
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-1">
                        {agents.map(a => (
                            <button
                                key={a.id}
                                onClick={() => selectAgent(a)}
                                className={`w-full flex items-center justify-between p-3 rounded-xl transition-all border ${
                                    selectedAgentId === a.id 
                                    ? 'bg-indigo-500/10 border-indigo-500/30 text-white shadow-lg shadow-indigo-500/5' 
                                    : 'border-transparent hover:bg-gray-800/50 text-gray-400'
                                }`}
                            >
                                <div className="flex flex-col items-start min-w-0">
                                    <span className="font-mono text-xs font-bold truncate w-full uppercase tracking-tighter">
                                        {a.id}
                                    </span>
                                    <div className="flex items-center gap-2 mt-1">
                                        <div className={`w-1.5 h-1.5 rounded-full ${a.enabled ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]' : 'bg-gray-600'}`} />
                                        <span className="text-[9px] uppercase font-bold tracking-widest opacity-50">
                                            {a.enabled ? 'Active' : 'Dormant'}
                                        </span>
                                    </div>
                                </div>
                                <ChevronRight size={14} className={`shrink-0 transition-transform ${selectedAgentId === a.id ? 'translate-x-0' : '-translate-x-2 opacity-0'}`} />
                            </button>
                        ))}
                        {agents.length === 0 && !isLoading && (
                            <div className="py-12 text-center px-4">
                                <Activity size={32} className="mx-auto text-gray-800 mb-3" />
                                <p className="text-[10px] font-mono text-gray-600 uppercase">No_Agents_Initialized</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Main Config Area */}
                <div className="flex-1 overflow-y-auto bg-black/20">
                    {selectedAgentId ? (
                        <div className="p-8 max-w-4xl mx-auto space-y-8">
                            <div className="flex items-start justify-between">
                                <div className="space-y-1">
                                    <h2 className="text-2xl font-light tracking-tight text-white uppercase font-mono flex items-center gap-3">
                                        <Sparkles size={24} className="text-indigo-400" />
                                        {editId}
                                    </h2>
                                    <p className="text-[10px] text-gray-500 font-mono tracking-widest uppercase">Autonomous Symbolic Entity Configuration</p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <button 
                                        onClick={() => handleDelete(editId)}
                                        className="p-2 text-gray-600 hover:text-red-400 transition-colors rounded-lg hover:bg-red-400/10"
                                        title="Delete Agent"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                    <button 
                                        onClick={handleSave}
                                        disabled={isSaving}
                                        className={`flex items-center gap-2 px-6 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all shadow-xl ${
                                            saveSuccess 
                                            ? 'bg-emerald-600 text-white' 
                                            : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                                        }`}
                                    >
                                        {isSaving ? <Loader2 size={14} className="animate-spin" /> : (saveSuccess ? <CheckCircle2 size={14} /> : <Save size={14} />)}
                                        {saveSuccess ? 'Committed' : 'Commit Changes'}
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Left Column: Identity & Schedule */}
                                <div className="space-y-6">
                                    <section className="bg-gray-900/40 rounded-2xl p-6 border border-gray-800 shadow-lg space-y-4">
                                        <div className="flex items-center gap-2 text-indigo-400 mb-2">
                                            <Settings2 size={16} />
                                            <h3 className="text-[10px] font-bold uppercase tracking-widest font-mono">Control_Parameters</h3>
                                        </div>
                                        
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between p-3 bg-black/40 rounded-xl border border-gray-800/50">
                                                <div className="flex flex-col">
                                                    <span className="text-xs font-bold text-gray-300 uppercase tracking-wide">Operational Status</span>
                                                    <span className="text-[9px] text-gray-500 font-mono">Toggle autonomous background execution</span>
                                                </div>
                                                <button 
                                                    onClick={() => setEditEnabled(!editEnabled)}
                                                    className={`relative w-12 h-6 rounded-full transition-colors duration-300 ${editEnabled ? 'bg-emerald-600' : 'bg-gray-700'}`}
                                                >
                                                    <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-300 ${editEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                                                </button>
                                            </div>

                                            <div className="space-y-2">
                                                <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-gray-600 font-mono">
                                                    <Clock size={12} /> Execution_Schedule
                                                </label>
                                                <input 
                                                    value={editSchedule}
                                                    onChange={(e) => setEditSchedule(e.target.value)}
                                                    placeholder="e.g. 0 * * * * (Every hour)"
                                                    className="w-full bg-black/40 border border-gray-800 rounded-xl px-4 py-3 text-sm font-mono text-indigo-300 focus:border-indigo-500 outline-none transition-colors"
                                                />
                                            </div>
                                        </div>
                                    </section>

                                    <section className="bg-gray-900/40 rounded-2xl p-6 border border-gray-800 shadow-lg space-y-4">
                                        <div className="flex items-center gap-2 text-emerald-400 mb-2">
                                            <Hash size={16} />
                                            <h3 className="text-[10px] font-bold uppercase tracking-widest font-mono">Delta_Subscriptions</h3>
                                        </div>
                                        <div className="space-y-4">
                                            <div className="flex gap-2">
                                                <input 
                                                    value={newSub}
                                                    onChange={(e) => setNewSub(e.target.value)}
                                                    onKeyDown={(e) => e.key === 'Enter' && addSubscription()}
                                                    placeholder="Trigger keyword or phrase..."
                                                    className="flex-1 bg-black/40 border border-gray-800 rounded-xl px-4 py-2 text-xs font-mono text-emerald-300 focus:border-emerald-500 outline-none transition-colors"
                                                />
                                                <button 
                                                    onClick={addSubscription}
                                                    className="p-2 bg-emerald-600/20 text-emerald-400 border border-emerald-600/30 rounded-xl hover:bg-emerald-600/30 transition-colors"
                                                >
                                                    <Plus size={18} />
                                                </button>
                                            </div>
                                            <div className="flex flex-wrap gap-2 min-h-[60px] p-3 bg-black/20 rounded-xl border border-dashed border-gray-800">
                                                {editSubscriptions.map(sub => (
                                                    <div key={sub} className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-[10px] text-emerald-400 font-bold tracking-wide group">
                                                        {sub}
                                                        <button onClick={() => removeSubscription(sub)} className="hover:text-red-400 transition-colors">
                                                            <XCircle size={12} />
                                                        </button>
                                                    </div>
                                                ))}
                                                {editSubscriptions.length === 0 && (
                                                    <span className="text-[10px] text-gray-600 font-mono italic">No active triggers...</span>
                                                )}
                                            </div>
                                        </div>
                                    </section>
                                </div>

                                {/* Right Column: Core Protocol */}
                                <div className="space-y-6">
                                    <section className="bg-gray-900/40 rounded-2xl p-6 border border-gray-800 shadow-lg flex flex-col h-full">
                                        <div className="flex items-center gap-2 text-amber-400 mb-4">
                                            <Terminal size={16} />
                                            <h3 className="text-[10px] font-bold uppercase tracking-widest font-mono">Cognitive_Protocol</h3>
                                        </div>
                                        <textarea 
                                            value={editPrompt}
                                            onChange={(e) => setEditPrompt(e.target.value)}
                                            placeholder="Define the agent's identity, mission, and response parameters..."
                                            className="flex-1 min-h-[300px] bg-black/40 border border-gray-800 rounded-xl p-4 font-mono text-xs leading-relaxed text-gray-400 focus:border-amber-500 outline-none transition-colors resize-none"
                                            spellCheck={false}
                                        />
                                    </section>
                                </div>
                            </div>

                            {/* Execution Logs */}
                            <section className="bg-gray-900/20 rounded-2xl border border-gray-800 overflow-hidden shadow-lg">
                                <div className="p-4 border-b border-gray-800 bg-gray-900/40 flex items-center justify-between">
                                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-500 font-mono">Audit_Trail</h3>
                                    <div className="flex items-center gap-4 text-[10px] font-mono text-gray-600">
                                        <span>RETENTION: 20_RUNS</span>
                                    </div>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="border-b border-gray-800/50">
                                                <th className="px-6 py-3 text-[10px] font-bold text-gray-600 uppercase tracking-widest font-mono">Timestamp</th>
                                                <th className="px-6 py-3 text-[10px] font-bold text-gray-600 uppercase tracking-widest font-mono">Status</th>
                                                <th className="px-6 py-3 text-[10px] font-bold text-gray-600 uppercase tracking-widest font-mono">Traces</th>
                                                <th className="px-6 py-3 text-[10px] font-bold text-gray-600 uppercase tracking-widest font-mono">Response_Preview</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {logs.map(log => (
                                                <tr key={log.id} className="border-b border-gray-800/30 hover:bg-white/5 transition-colors">
                                                    <td className="px-6 py-4 text-xs font-mono text-gray-400">
                                                        {new Date(log.startedAt).toLocaleString()}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest ${
                                                            log.status === 'completed' ? 'bg-emerald-500/10 text-emerald-500' : 
                                                            log.status === 'running' ? 'bg-indigo-500/10 text-indigo-500 animate-pulse' : 
                                                            'bg-red-500/10 text-red-500'
                                                        }`}>
                                                            {log.status}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 text-xs font-mono text-indigo-400">
                                                        {log.traceCount || 0} ΣTR
                                                    </td>
                                                    <td className="px-6 py-4 text-xs font-mono text-gray-500 truncate max-w-xs italic">
                                                        {log.responsePreview || '--'}
                                                    </td>
                                                </tr>
                                            ))}
                                            {logs.length === 0 && (
                                                <tr>
                                                    <td colSpan={4} className="px-6 py-12 text-center text-gray-600 font-mono text-[10px] uppercase">
                                                        Operational_History_Empty
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </section>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center space-y-6 opacity-30">
                            <div className="relative">
                                <div className="absolute inset-0 bg-indigo-500/20 blur-3xl rounded-full animate-pulse"></div>
                                <Activity size={80} className="text-indigo-500 relative z-10" />
                            </div>
                            <div className="text-center space-y-2">
                                <h2 className="text-xl font-light uppercase tracking-[0.3em] text-white">Agent_Orchestrator</h2>
                                <p className="text-[10px] font-mono uppercase tracking-widest text-gray-500">Select or initialize an autonomous entity to begin</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
