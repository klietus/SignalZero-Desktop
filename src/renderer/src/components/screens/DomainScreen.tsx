
import React, { useState, useEffect } from 'react';
import { ToggleLeft, ToggleRight, Plus, Edit3, Loader2, Trash2, Settings, User as UserIcon, Globe, RefreshCcw, X } from 'lucide-react';
import { Header, HeaderProps } from '../Header';

interface DomainScreenProps {
  onNavigateToForge: (domain: string) => void;
  headerProps: Omit<HeaderProps, 'children'>;
}

export const DomainScreen: React.FC<DomainScreenProps> = ({ onNavigateToForge, headerProps }) => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newDomainId, setNewDomainId] = useState('');
  const [newDomainName, setNewDomainName] = useState('');
  const [newDomainDesc, setNewDomainDesc] = useState('');
  const [newDomainInvariants, setNewDomainInvariants] = useState<string[]>([]);
  const [newInvariantInputCreate, setNewInvariantInputCreate] = useState('');

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editDomainId, setEditDomainId] = useState('');
  const [editDomainName, setEditDomainName] = useState('');
  const [editDomainDesc, setEditDomainDesc] = useState('');
  const [editDomainInvariants, setEditDomainInvariants] = useState<string[]>([]);
  const [newInvariantInputEdit, setNewInvariantInputEdit] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
        const meta = await window.api.getMetadata();
        const sortedMeta = [...meta].sort((a, b) => {
            const nameA = (a.name || a.id).toLowerCase();
            const nameB = (b.name || b.id).toLowerCase();
            return nameA.localeCompare(nameB);
        });
        setItems(sortedMeta);
    } catch(e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleCreateDomain = async () => {
      if (!newDomainId.trim()) return;
      const id = newDomainId.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
      // Create the domain first with metadata
      await window.api.upsertDomain(id, { name: newDomainName || id, description: newDomainDesc, invariants: newDomainInvariants });
      // Then add the INIT symbol
      await window.api.upsertSymbol(id, { id: 'INIT', name: 'Domain Initialization', triad: '⟐⟐⟐', symbol_domain: id, role: 'Init' });
      
      loadData();
      setIsCreateModalOpen(false);
      onNavigateToForge(id);
  };

  const handleEditClick = (item: any) => {
      setEditDomainId(item.id);
      setEditDomainName(item.name || item.id);
      setEditDomainDesc(item.description || '');
      setEditDomainInvariants(item.invariants || []);
      setIsEditModalOpen(true);
  };

  const handleUpdateDomain = async () => {
      if (!editDomainId) return;
      await window.api.updateDomain(editDomainId, { name: editDomainName || editDomainId, description: editDomainDesc, invariants: editDomainInvariants });
      await loadData();
      setIsEditModalOpen(false);
  };

  const handleToggleEnable = async (id: string, currentEnabled: boolean) => {
      await window.api.updateDomain(id, { enabled: !currentEnabled });
      loadData();
  };

  const handleDeleteDomain = async (id: string) => {
      const confirmed = window.confirm(`Delete domain "${id}"? This action cannot be undone.`);
      if (!confirmed) return;
      setLoading(true);
      try {
          await window.api.deleteDomain(id); 
          loadData();
      } catch (e: any) {
          console.error(e);
      } finally {
          setLoading(false);
      }
  };

  const handleAddInvariantCreate = () => { if (newInvariantInputCreate.trim()) { setNewDomainInvariants(p => [...p, newInvariantInputCreate.trim()]); setNewInvariantInputCreate(''); } };
  const handleRemoveInvariantCreate = (i: number) => { setNewDomainInvariants(p => p.filter((_, idx) => idx !== i)); };
  
  const handleAddInvariantEdit = () => { if (newInvariantInputEdit.trim()) { setEditDomainInvariants(p => [...p, newInvariantInputEdit.trim()]); setNewInvariantInputEdit(''); } };
  const handleRemoveInvariantEdit = (i: number) => { setEditDomainInvariants(p => p.filter((_, idx) => idx !== i)); };

  return (
    <div className="flex flex-col h-full bg-gray-950 font-sans">
      <Header {...headerProps}>
         <div className="flex items-center gap-2">
             <button onClick={loadData} className="flex items-center gap-2 px-3 py-1.5 bg-gray-900 hover:bg-gray-800 text-gray-300 rounded-md text-xs font-mono font-bold transition-colors border border-gray-800"><RefreshCcw size={14} className={loading ? "animate-spin" : ""} /> Refresh</button>
             <button onClick={() => setIsCreateModalOpen(true)} className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs font-mono font-bold transition-colors"><Plus size={14} /> Create</button>
         </div>
      </Header>
      
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto space-y-4">
            {loading && items.length === 0 ? (
                <div className="text-center py-20 text-gray-500 font-mono text-sm flex flex-col items-center gap-4">
                    <Loader2 className="animate-spin text-indigo-500" size={32} />
                    Initializing domain registry...
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {items.map((item) => (
                        <div key={item.id} className={`relative p-5 rounded-lg border transition-all flex flex-col gap-4 group ${item.enabled ? 'bg-gray-900 border-emerald-500/30 shadow-sm' : 'bg-gray-900/50 border-gray-800 opacity-75'}`}>
                            <div className="flex justify-between items-start">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <h3 className="font-bold font-mono text-gray-100 truncate max-w-[150px]">{item.name}</h3>
                                        {item.id === 'user' || item.id === 'state' ? (
                                            <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-900/30 text-blue-400 rounded text-[9px] font-bold uppercase tracking-wider font-mono border border-blue-800" title="User-specific domain"><UserIcon size={10} /> Individual</span>
                                        ) : (
                                            <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-900/30 text-amber-400 rounded text-[9px] font-bold uppercase tracking-wider font-mono border border-amber-800" title="Global domain shared across users"><Globe size={10} /> Global</span>
                                        )}
                                    </div>
                                    <div className="text-[10px] text-gray-400 font-mono mt-0.5 truncate max-w-[150px]">{item.id}</div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    {item.id !== 'root' && item.id !== 'user' && item.id !== 'state' && (
                                        <button
                                            onClick={() => handleDeleteDomain(item.id)}
                                            className="p-2 text-red-400 hover:text-red-600 transition-colors"
                                            title="Delete domain"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                    <button
                                        onClick={() => handleEditClick(item)}
                                        className="p-2 text-gray-500 hover:text-gray-200 transition-colors"
                                        title="Edit domain metadata"
                                    >
                                        <Settings size={16} />
                                    </button>
                                    <button onClick={() => handleToggleEnable(item.id, item.enabled)} className={`transition-colors p-1 ${item.enabled ? 'text-emerald-500 hover:text-emerald-600' : 'text-gray-400 hover:text-gray-600'}`}>{item.enabled ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}</button>
                                </div>
                            </div>

                            <div className="text-xs text-gray-400 leading-relaxed min-h-[48px] max-h-[48px] overflow-hidden">
                                {item.description || 'No description provided.'}
                            </div>

                            <div className="flex items-center justify-between gap-3 border-t border-gray-800 pt-3">
                                <div className="grid grid-cols-2 gap-4 text-xs font-mono text-gray-400">
                                    <div>
                                        <span className="block text-[10px] text-gray-500 uppercase">Symbols</span>
                                        <span className="font-bold text-lg">{item.symbolCount || 0}</span>
                                    </div>
                                    <div>
                                        <span className="block text-[10px] text-gray-500 uppercase">Invariants</span>
                                        <span className="font-bold text-lg">{item.invariants?.length || 0}</span>
                                    </div>
                                </div>
                                <button
                                    onClick={() => onNavigateToForge(item.id)}
                                    className="shrink-0 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-[11px] font-mono font-bold flex items-center gap-2 transition-colors"
                                >
                                    <Edit3 size={12} />
                                    Open
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
      </div>

      {isCreateModalOpen && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
              <div className="bg-gray-900 rounded-xl shadow-2xl max-w-md w-full p-6 border border-gray-800 flex flex-col max-h-[90vh] overflow-hidden">
                  <h3 className="font-bold font-mono mb-4 text-emerald-500 flex items-center gap-2"><Plus size={18} /> Create Domain</h3>
                  <div className="overflow-y-auto space-y-4 pr-2">
                      <div className="space-y-1"><label className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono">Domain ID (Slug)</label><input className="w-full bg-black border border-gray-800 rounded p-2 font-mono text-sm text-gray-100" value={newDomainId} onChange={e => setNewDomainId(e.target.value)} /></div>
                      <div className="space-y-1"><label className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono">Display Name</label><input className="w-full bg-black border border-gray-800 rounded p-2 text-sm text-gray-100" value={newDomainName} onChange={e => setNewDomainName(e.target.value)} /></div>
                      <div className="space-y-1"><label className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono">Description</label><textarea value={newDomainDesc} onChange={e => setNewDomainDesc(e.target.value)} className="w-full bg-black border border-gray-800 rounded p-2 text-sm text-gray-100" /></div>
                      <div className="space-y-1">
                          <label className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono">Invariants</label>
                          <div className="flex gap-2">
                              <input value={newInvariantInputCreate} onChange={e => setNewInvariantInputCreate(e.target.value)} className="flex-1 bg-black border border-gray-800 rounded p-2 text-xs font-mono text-gray-100" />
                              <button onClick={handleAddInvariantCreate} className="px-3 bg-emerald-600 text-white rounded text-xs font-bold">Add</button>
                          </div>
                          <div className="mt-1 space-y-1 max-h-32 overflow-y-auto">
                              {newDomainInvariants.map((inv, i) => <div key={i} className="flex justify-between bg-black p-1 rounded text-xs font-mono text-gray-400 border border-gray-800"><span>{inv}</span><button onClick={() => handleRemoveInvariantCreate(i)} className="text-gray-500 hover:text-red-400"><X size={12}/></button></div>)}
                          </div>
                      </div>
                  </div>
                  <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-gray-800"><button onClick={() => setIsCreateModalOpen(false)} className="px-4 py-2 text-xs font-mono text-gray-400">Cancel</button><button onClick={handleCreateDomain} disabled={!newDomainId} className="px-4 py-2 bg-emerald-600 text-white rounded text-xs font-mono font-bold uppercase tracking-widest transition-all">Create</button></div>
              </div>
          </div>
      )}

      {isEditModalOpen && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
              <div className="bg-gray-900 rounded-xl shadow-2xl max-w-md w-full p-6 border border-gray-800 flex flex-col max-h-[90vh] overflow-hidden">
                  <h3 className="font-bold font-mono mb-4 text-gray-100 flex items-center gap-2"><Settings size={18} /> Edit Domain</h3>
                  <div className="overflow-y-auto space-y-4 pr-2">
                      <div className="space-y-1"><label className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono">Domain ID</label><input disabled className="w-full bg-black border border-gray-800 rounded p-2 font-mono text-sm text-gray-500 opacity-50" value={editDomainId} /></div>
                      <div className="space-y-1"><label className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono">Display Name</label><input className="w-full bg-black border border-gray-800 rounded p-2 text-sm text-gray-100" value={editDomainName} onChange={e => setEditDomainName(e.target.value)} /></div>
                      <div className="space-y-1"><label className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono">Description</label><textarea value={editDomainDesc} onChange={e => setEditDomainDesc(e.target.value)} className="w-full bg-black border border-gray-800 rounded p-2 text-sm text-gray-100" /></div>
                      <div className="space-y-1">
                          <label className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono">Invariants</label>
                          <div className="flex gap-2">
                              <input value={newInvariantInputEdit} onChange={e => setNewInvariantInputEdit(e.target.value)} className="flex-1 bg-black border border-gray-800 rounded p-2 text-xs font-mono text-gray-100" />
                              <button onClick={handleAddInvariantEdit} className="px-3 bg-gray-800 text-gray-300 rounded text-xs font-bold">Add</button>
                          </div>
                          <div className="mt-1 space-y-1 max-h-32 overflow-y-auto">
                              {editDomainInvariants.map((inv, i) => <div key={i} className="flex justify-between bg-black p-1 rounded text-xs font-mono text-gray-400 border border-gray-800"><span>{inv}</span><button onClick={() => handleRemoveInvariantEdit(i)} className="text-gray-500 hover:text-red-400"><X size={12}/></button></div>)}
                          </div>
                      </div>
                  </div>
                  <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-gray-800"><button onClick={() => setIsEditModalOpen(false)} className="px-4 py-2 text-xs font-mono text-gray-400">Cancel</button><button onClick={handleUpdateDomain} className="px-4 py-2 bg-emerald-600 text-white rounded text-xs font-mono font-bold uppercase tracking-widest transition-all">Update</button></div>
              </div>
          </div>
      )}
    </div>
  );
};
