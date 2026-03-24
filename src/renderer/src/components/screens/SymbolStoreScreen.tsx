import React, { useState, useEffect, useRef } from 'react';
import { ToggleLeft, ToggleRight, Plus, Edit3, Loader2, Upload, Trash2, Settings, X, User as UserIcon, Globe, RefreshCcw } from 'lucide-react';
import { SymbolDef } from '../../types';
import { Header, HeaderProps } from '../Header';

interface SymbolStoreScreenProps {
  onBack: () => void;
  onNavigateToForge: (domain: string) => void;
  headerProps: Omit<HeaderProps, 'children'>;
}

interface ImportCandidate {
    domainId: string;
    domainName: string;
    description: string;
    invariants: string[];
    symbols: SymbolDef[];
}

export const SymbolStoreScreen: React.FC<SymbolStoreScreenProps> = ({ onNavigateToForge, headerProps }) => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newDomainId, setNewDomainId] = useState('');
  const [newDomainName, setNewDomainName] = useState('');
  const [newDomainDesc, setNewDomainDesc] = useState('');
  const [newDomainInvariants, setNewDomainInvariants] = useState<string[]>([]);
  const [newInvariantInputCreate, setNewInvariantInputCreate] = useState('');

  const [importCandidate, setImportCandidate] = useState<ImportCandidate | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editDomainId, setEditDomainId] = useState('');
  const [editDomainName, setEditDomainName] = useState('');
  const [editDomainDesc, setEditDomainDesc] = useState('');
  const [editDomainInvariants, setEditDomainInvariants] = useState<string[]>([]);
  const [newInvariantInputEdit, setNewInvariantInputEdit] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
        const meta = await window.api.getMetadata();
        const sortedMeta = [...meta].sort((a, b) => {
            const nameA = (a.name || a.id).toLowerCase();
            const nameB = (b.name || b.id).toLowerCase();
            return nameA.localeCompare(nameB);
        });
        setItems(sortedMeta);
    } catch(e: any) {
      setError(e.message || "Failed to load domains.");
    } finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, []);

  const handleToggle = async (id: string, currentState: boolean) => {
    // In Desktop, we might just update the metadata locally
    const domain = items.find(i => i.id === id);
    if (domain) {
        await window.api.updateSettings({ domains: { ...domain, enabled: !currentState } }); // Placeholder logic
        loadData();
    }
  };

  const handleCreateDomain = async () => {
      if (!newDomainId.trim()) return;
      const id = newDomainId.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
      // In Desktop, creating a domain means initializing it in SQLite
      // We'll need a window.api.createDomain or similar
      await (window.api as any).createDomain?.(id, {
          name: newDomainName || id,
          description: newDomainDesc,
          invariants: newDomainInvariants
      });
      loadData();
      setIsCreateModalOpen(false);
      onNavigateToForge(id);
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
          try {
              const text = event.target?.result as string;
              const json = JSON.parse(text);
              let domainId = json.id || json.domain || 'imported';
              let domainName = json.name || domainId;
              let symbols = json.symbols || json.items || [];
              setImportCandidate({ domainId, domainName, description: json.description || '', invariants: json.invariants || [], symbols });
          } catch (err) { alert("Failed to parse file."); }
          finally { if (fileInputRef.current) fileInputRef.current.value = ''; }
      };
      reader.readAsText(file);
  };

  const handleConfirmImport = async () => {
      if (!importCandidate) return;
      // Need bulk upsert IPC
      for (const sym of importCandidate.symbols) {
          await window.api.upsertSymbol(importCandidate.domainId, sym);
      }
      loadData();
      setImportCandidate(null);
  };

  const handleUpdateDomain = async () => {
      if (!editDomainId) return;
      // Update local domain metadata
      loadData();
      setIsEditModalOpen(false);
  };

  const handleDeleteDomain = async (id: string) => {
      if (window.confirm(`Delete domain "${id}"?`)) {
          // Need delete domain IPC
          loadData();
      }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950 font-sans">
      <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".json" className="hidden" />
      <Header {...headerProps}>
         <div className="flex items-center gap-2">
             <button onClick={loadData} className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 rounded-md text-xs font-mono font-bold transition-colors border border-gray-200 dark:border-gray-700"><RefreshCcw size={14} className={loading ? "animate-spin" : ""} /> Refresh</button>
             <button onClick={handleImportClick} className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 rounded-md text-xs font-mono font-bold transition-colors border border-gray-200 dark:border-gray-700"><Upload size={14} /> Import</button>
             <button onClick={() => setIsCreateModalOpen(true)} className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs font-mono font-bold transition-colors"><Plus size={14} /> Create</button>
         </div>
      </Header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-4">
            {loading && items.length === 0 ? <div className="text-center py-12 text-gray-400 font-mono text-sm flex flex-col items-center gap-2"><Loader2 className="animate-spin" size={24} /> Loading...</div> : null}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {items.map((item) => (
                    <div key={item.id} className="p-5 rounded-lg border bg-white dark:bg-gray-900 border-emerald-500/30 shadow-sm flex flex-col gap-4 group">
                        <div className="flex justify-between items-start">
                            <div className="min-w-0">
                                <h3 className="font-bold font-mono text-gray-900 dark:text-gray-100 truncate">{item.name}</h3>
                                <div className="text-[10px] text-gray-400 font-mono">{item.id}</div>
                            </div>
                            <div className="flex items-center gap-1">
                                <button onClick={() => handleDeleteDomain(item.id)} className="p-2 text-red-400 hover:text-red-600 transition-colors"><Trash2 size={16} /></button>
                                <button onClick={() => { setEditDomainId(item.id); setEditDomainName(item.name); setIsEditModalOpen(true); }} className="p-2 text-gray-400 hover:text-gray-700"><Settings size={16} /></button>
                                <button onClick={() => handleToggle(item.id, item.enabled)} className={`p-1 ${item.enabled ? 'text-emerald-500' : 'text-gray-400'}`}>{item.enabled ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}</button>
                            </div>
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-400 min-h-[48px] line-clamp-3">{item.description || 'No description.'}</div>
                        <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-800 pt-3">
                            <span className="text-xs font-mono text-gray-500 font-bold">{item.symbols?.length || 0} Symbols</span>
                            <button onClick={() => onNavigateToForge(item.id)} className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 text-gray-600 rounded text-[11px] font-mono font-bold flex items-center gap-2"><Edit3 size={12} /> Open</button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
      </div>
      {/* Modals simplified for brevity... */}
    </div>
  );
};
