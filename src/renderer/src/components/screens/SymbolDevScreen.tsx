import React, { useState, useEffect, useRef } from 'react';
import { Save, Plus, ChevronRight, Check, AlertTriangle, Loader2, Trash2, GitMerge, Layout, Box, ArrowRightLeft, X, User, UserCog, Database, RefreshCcw } from 'lucide-react';
import { SymbolDef, SymbolFacet } from '../../types';
import { Header, HeaderProps } from '../Header';

interface SymbolDevScreenProps {
    onBack: () => void;
    initialDomain?: string | null;
    initialSymbol?: SymbolDef | null;
    headerProps: Omit<HeaderProps, 'children'>;
}

const DEFAULT_PATTERN: SymbolDef = {
    id: 'NEW-PATTERN',
    name: 'New Pattern',
    kind: 'pattern',
    triad: '⟐⇌⟐',
    role: '',
    macro: '',
    activation_conditions: [],
    symbol_domain: 'root',
    symbol_tag: 'draft',
    facets: {
        function: 'diagnose',
        topology: 'linear',
        commit: 'ledger',
        temporal: 'instant',
        gate: [],
        substrate: ['symbolic'],
        invariants: []
    },
    failure_mode: '',
    linked_patterns: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
};

const DEFAULT_LATTICE: SymbolDef = {
    id: 'NEW-LATTICE',
    name: 'New Lattice',
    kind: 'lattice',
    triad: '⟐≡⟐',
    role: '',
    macro: '',
    lattice: {
        topology: 'inductive',
        closure: 'agent'
    },
    activation_conditions: [],
    symbol_domain: 'root',
    symbol_tag: 'draft',
    facets: {
        function: 'orchestrate',
        topology: 'lattice',
        commit: 'recursive',
        temporal: 'flow',
        gate: [],
        substrate: ['symbolic'],
        invariants: []
    },
    failure_mode: '',
    linked_patterns: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
};

const DEFAULT_PERSONA: SymbolDef = {
    id: 'NEW-PERSONA',
    name: 'New Persona',
    kind: 'persona',
    triad: '⟐⟐⟐',
    role: 'Persona Agent',
    macro: '',
    activation_conditions: [],
    symbol_domain: 'root',
    symbol_tag: 'persona',
    facets: {
        function: 'interact',
        topology: 'recursive',
        commit: 'memory',
        temporal: 'narrative',
        gate: [],
        substrate: ['persona'],
        invariants: []
    },
    persona: {
        recursion_level: 'root',
        function: '',
        fallback_behavior: [],
        linked_personas: []
    },
    failure_mode: '',
    linked_patterns: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
};

const DEFAULT_DATA: SymbolDef = {
    id: 'NEW-DATA',
    name: 'New Data',
    kind: 'data',
    triad: '⟐⛃⟐',
    role: 'Data Store',
    macro: '',
    activation_conditions: [],
    symbol_domain: 'root',
    symbol_tag: 'data',
    facets: {
        function: 'store',
        topology: 'static',
        commit: 'persistent',
        temporal: 'state',
        gate: [],
        substrate: ['data'],
        invariants: []
    },
    data: {
        source: 'manual',
        verification: 'unverified',
        status: 'active',
        payload: {}
    },
    failure_mode: '',
    linked_patterns: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
};

const INPUT_STYLE = "w-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-all text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500";

const Label = ({ children }: { children?: React.ReactNode }) => (
    <label className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono block mb-1">
        {children}
    </label>
);

const AutoResizeTextarea = ({ value, onChange, className, placeholder, rows = 2, disabled, ...props }: any) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [value]);
    return (
        <textarea
            ref={textareaRef} value={value} onChange={onChange} rows={rows}
            placeholder={placeholder} disabled={disabled}
            className={`${className} resize-none overflow-hidden block`}
            {...props}
        />
    );
};

const safeJoin = (arr: any, sep: string) => {
    if (Array.isArray(arr)) {
        return arr.map(item => typeof item === 'object' ? (item.id || JSON.stringify(item)) : String(item)).join(sep);
    }
    return '';
};

const sanitizeForEditor = (raw: any): SymbolDef => {
    const copy = JSON.parse(JSON.stringify(raw));
    const mergedActivationConditions = [
        ...(Array.isArray(copy.activation_conditions) ? copy.activation_conditions : []),
        ...(Array.isArray(copy.lattice?.activation_conditions) ? copy.lattice.activation_conditions : []),
        ...(Array.isArray(copy.persona?.activation_conditions) ? copy.persona.activation_conditions : []),
    ]
        .map((item: any) => typeof item === 'object' ? (item.id || JSON.stringify(item)) : String(item))
        .map((item: string) => item.trim())
        .filter((item: string) => item.length > 0);

    copy.activation_conditions = Array.from(new Set(mergedActivationConditions));
    copy.name = copy.name || '';
    copy.triad = copy.triad || '';
    copy.role = copy.role || '';
    copy.macro = copy.macro || '';
    copy.symbol_tag = copy.symbol_tag || '';
    copy.failure_mode = copy.failure_mode || '';
    copy.kind = copy.kind || 'pattern';
    if (!copy.symbol_domain || copy.symbol_domain === 'undefined') copy.symbol_domain = 'root';
    
    if (Array.isArray(copy.linked_patterns)) {
        copy.linked_patterns = copy.linked_patterns.map((item: any) => {
            if (typeof item === 'string') return { id: item, link_type: 'relates_to', bidirectional: false };
            return item;
        });
    } else copy.linked_patterns = [];

    if (!copy.facets) copy.facets = {};
    copy.facets.function = copy.facets.function || '';
    copy.facets.topology = copy.facets.topology || '';
    copy.facets.commit = copy.facets.commit || '';
    copy.facets.temporal = copy.facets.temporal || '';
    copy.facets.gate = copy.facets.gate || [];
    copy.facets.substrate = copy.facets.substrate || [];
    copy.facets.invariants = copy.facets.invariants || [];

    if (copy.kind === 'lattice') {
        if (!copy.lattice) copy.lattice = {};
        copy.lattice.topology = copy.lattice.topology || 'inductive';
        copy.lattice.closure = copy.lattice.closure || 'agent';
    }
    if (copy.kind === 'persona') {
        if (!copy.persona) copy.persona = {};
        copy.persona.recursion_level = copy.persona.recursion_level || 'root';
        copy.persona.function = copy.persona.function || '';
        copy.persona.fallback_behavior = copy.persona.fallback_behavior || [];
        copy.persona.linked_personas = copy.persona.linked_personas || [];
    }
    if (copy.kind === 'data') {
        if (!copy.data) copy.data = {};
        copy.data.source = copy.data.source || 'manual';
        copy.data.verification = copy.data.verification || 'unverified';
        copy.data.status = copy.data.status || 'active';
        copy.data.payload = copy.data.payload || {};
    }
    return copy as SymbolDef;
};

const SymbolRelationshipField = ({ items, onChange, placeholder }: { items: any[] | undefined, onChange: (newItems: any[]) => void, placeholder: string }) => {
    const safeItems = Array.isArray(items) ? items : [];
    const handleRemove = (indexToRemove: number) => {
        const newItems = safeItems.filter((_, idx) => idx !== indexToRemove);
        onChange(newItems);
    };
    const updateItem = (index: number, updates: any) => {
        const newItems = [...safeItems];
        newItems[index] = { ...newItems[index], ...updates };
        onChange(newItems);
    };
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const symbolId = e.dataTransfer.getData("text/plain");
        if (symbolId && !safeItems.some(item => (typeof item === 'object' ? item.id : item) === symbolId)) {
            onChange([...safeItems, { id: symbolId, link_type: 'relates_to', bidirectional: false }]);
        }
    };
    return (
        <div onDrop={handleDrop} onDragOver={e => e.preventDefault()} className="min-h-[60px] w-full bg-gray-50 dark:bg-gray-900/50 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg p-3 transition-colors hover:border-indigo-400 dark:hover:border-indigo-600">
            {safeItems.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-gray-400 italic pointer-events-none">{placeholder} (Drag symbols here)</div>
            ) : (
                <div className="space-y-2">
                    {safeItems.map((item, idx) => (
                        <div key={`${typeof item === 'object' ? item.id : item}-${idx}`} className="flex flex-wrap items-center gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2 shadow-sm group">
                            <span className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400 min-w-[120px] truncate">{typeof item === 'object' ? item.id : item}</span>
                            <select value={typeof item === 'object' ? item.link_type : 'relates_to'} onChange={(e) => updateItem(idx, { link_type: e.target.value })} className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-1.5 py-0.5 text-[10px]">
                                <option value="relates_to">relates_to</option>
                                <option value="depends_on">depends_on</option>
                                <option value="instance_of">instance_of</option>
                                <option value="part_of">part_of</option>
                                <option value="evolved_from">evolved_from</option>
                                <option value="conflicts_with">conflicts_with</option>
                            </select>
                            <button onClick={() => updateItem(idx, { bidirectional: !item.bidirectional })} className={`p-1 rounded ${item.bidirectional ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30' : 'text-gray-400'}`}><ArrowRightLeft size={12} /></button>
                            <div className="flex-1"></div>
                            <button onClick={() => handleRemove(idx)} className="p-1 text-gray-400 hover:text-red-500"><X size={14} /></button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export const SymbolDevScreen: React.FC<SymbolDevScreenProps> = ({ onBack, initialDomain, initialSymbol, headerProps }) => {
    const [domains, setDomains] = useState<string[]>([]);
    const [selectedDomain, setSelectedDomain] = useState<string>('');
    const [symbolList, setSymbolList] = useState<any[]>([]);
    const [currentSymbol, setCurrentSymbol] = useState<SymbolDef>(DEFAULT_PATTERN);
    const [originalId, setOriginalId] = useState<string | null>(null);
    const [isDirty, setIsDirty] = useState(false);
    const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [deleteSymbolId, setDeleteSymbolId] = useState<string | null>(null);
    const [payloadText, setPayloadText] = useState("{}");
    const [isLoading, setIsLoading] = useState(false);

    const loadDomains = async () => {
        setIsLoading(true);
        try {
            const list = await window.api.listDomains();
            setDomains(list.sort());
            return list;
        } finally { setIsLoading(false); }
    };

    const handleRefresh = async () => {
        await loadDomains();
        if (selectedDomain) {
            const symbols = await window.api.searchSymbols('', 1000, { metadata_filter: { symbol_domain: selectedDomain } });
            setSymbolList(symbols.map(s => s.metadata));
        }
    };

    useEffect(() => {
        if (currentSymbol.kind === 'data' && currentSymbol.data?.payload) {
            setPayloadText(JSON.stringify(currentSymbol.data.payload, null, 2));
        }
    }, [currentSymbol.id, currentSymbol.kind]);

    useEffect(() => {
        const init = async () => {
            const localDomains = await loadDomains();
            let targetDomain = selectedDomain;
            if (initialSymbol?.symbol_domain && localDomains.includes(initialSymbol.symbol_domain)) targetDomain = initialSymbol.symbol_domain;
            else if (initialDomain && localDomains.includes(initialDomain)) targetDomain = initialDomain;
            else if (localDomains.length > 0 && !selectedDomain) targetDomain = localDomains[0];

            if (targetDomain) {
                setSelectedDomain(targetDomain);
                const res = await window.api.searchSymbols('', 1000, { metadata_filter: { symbol_domain: targetDomain } });
                setSymbolList(res.map(s => s.metadata));
            }

            if (initialSymbol) {
                const results = await window.api.searchSymbols(initialSymbol.id, 1, { metadata_filter: { id: initialSymbol.id } });
                const exists = results.length > 0 ? results[0].metadata : null;
                const sanitized = sanitizeForEditor(exists || initialSymbol);
                setCurrentSymbol(sanitized);
                if (exists) { setOriginalId(exists.id); setIsDirty(false); }
                else { setOriginalId(null); setIsDirty(true); setSaveMessage({ type: 'success', text: 'Candidate Loaded' }); }
            }
        };
        init();
    }, [initialDomain, initialSymbol]);

    useEffect(() => {
        if (!selectedDomain) return;
        window.api.searchSymbols('', 1000, { metadata_filter: { symbol_domain: selectedDomain } }).then(res => setSymbolList(res.map(s => s.metadata)));
    }, [selectedDomain]);

    const handleSelectSymbol = async (id: string) => {
        if (isDirty && !window.confirm("Discard unsaved changes?")) return;
        setSaveMessage(null);
        const res = await window.api.searchSymbols(id, 1, { metadata_filter: { id } });
        if (res.length > 0) {
            setCurrentSymbol(sanitizeForEditor(res[0].metadata));
            setOriginalId(res[0].metadata.id);
            setIsDirty(false);
        }
    };

    const handleSave = async () => {
        setSaveMessage(null);
        try {
            const targetDomain = currentSymbol.symbol_domain || selectedDomain || 'root';
            await window.api.upsertSymbol(targetDomain, currentSymbol);
            const res = await window.api.searchSymbols('', 1000, { metadata_filter: { symbol_domain: targetDomain } });
            setSymbolList(res.map(s => s.metadata));
            setOriginalId(currentSymbol.id);
            setSaveMessage({ type: 'success', text: 'Saved locally' });
            setIsDirty(false);
        } catch (e) {
            setSaveMessage({ type: 'error', text: 'Save failed' });
        }
    };

    const confirmDeleteSymbol = async () => {
        if (!deleteSymbolId) return;
        // Desktop version might need a delete symbol IPC, using upsert with null/removal for now or adding a delete IPC
        // For now, let's assume we'll add 'domain:delete-symbol' to IPC
        await (window.api as any).deleteContext(deleteSymbolId); // Placeholder
        setDeleteSymbolId(null);
    };

    const handleNewKind = (kind: 'pattern' | 'lattice' | 'persona' | 'data') => {
        if (isDirty && !window.confirm("Discard changes?")) return;
        const defaults = { pattern: DEFAULT_PATTERN, lattice: DEFAULT_LATTICE, persona: DEFAULT_PERSONA, data: DEFAULT_DATA };
        setCurrentSymbol({ ...defaults[kind], symbol_domain: selectedDomain || 'root', id: `${(selectedDomain || 'NEW').toUpperCase()}-${kind.toUpperCase().slice(0,3)}` });
        setOriginalId(null);
        setIsDirty(false);
    };

    const handleChange = (field: keyof SymbolDef, value: any) => { setCurrentSymbol(prev => ({ ...prev, [field]: value })); setIsDirty(true); };
    const handleFacetChange = (field: keyof SymbolFacet, value: any) => { setCurrentSymbol(prev => ({ ...prev, facets: { ...(prev.facets || DEFAULT_PATTERN.facets), [field]: value } })); setIsDirty(true); };

    return (
        <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950 font-sans relative">
            <Header {...headerProps}>
                <div className="flex items-center gap-4">
                    <button onClick={handleRefresh} className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md text-xs font-mono font-bold transition-colors border border-gray-200 dark:border-gray-700">
                        <RefreshCcw size={14} className={isLoading ? "animate-spin" : ""} /> Refresh
                    </button>
                    {saveMessage && <span className={`text-xs font-mono flex items-center gap-1 ${saveMessage.type === 'success' ? 'text-emerald-500' : 'text-amber-500'}`}><Check size={14} /> {saveMessage.text}</span>}
                    <button onClick={handleSave} disabled={!isDirty} className="flex items-center gap-2 px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-mono text-sm font-bold transition-all">
                        <Save size={16} /> {isDirty ? 'Save to Cache' : 'Saved'}
                    </button>
                </div>
            </Header>

            <div className="flex-1 flex overflow-hidden">
                <div className="w-80 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col shrink-0">
                    <div className="p-4 border-b border-gray-200 dark:border-gray-800">
                        <Label>Local Domain</Label>
                        <select value={selectedDomain} onChange={e => setSelectedDomain(e.target.value)} className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-2 text-sm font-mono">
                            {domains.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-4">
                        {['pattern', 'lattice', 'persona', 'data'].map(kind => (
                            <div key={kind}>
                                <div className="flex items-center justify-between px-2 pb-1 mb-1 border-b border-gray-100 dark:border-gray-800">
                                    <div className="text-[10px] font-mono font-bold uppercase text-gray-400">{kind}s</div>
                                    <button onClick={() => handleNewKind(kind as any)} className="text-gray-400 hover:text-emerald-500 p-1"><Plus size={12} /></button>
                                </div>
                                {symbolList.filter(s => (s.kind || 'pattern') === kind).map(sym => (
                                    <button key={sym.id} onClick={() => handleSelectSymbol(sym.id)} className={`w-full text-left p-2 rounded text-xs font-mono truncate transition-colors ${currentSymbol.id === sym.id ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600'}`}>{sym.id}</button>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex-1 flex flex-col h-full overflow-hidden">
                    <div className="flex-1 overflow-y-auto p-8">
                        <div className="max-w-4xl mx-auto space-y-8 pb-20">
                            <section className="bg-white dark:bg-gray-900 rounded-lg p-6 border border-gray-200 dark:border-gray-800 shadow-sm space-y-4">
                                <Label>Identity</Label>
                                <div className="grid grid-cols-2 gap-6">
                                    <input type="text" value={currentSymbol.id} onChange={e => handleChange('id', e.target.value)} className={INPUT_STYLE} placeholder="ID" />
                                    <input type="text" value={currentSymbol.name} onChange={e => handleChange('name', e.target.value)} className={INPUT_STYLE} placeholder="Name" />
                                    <input type="text" value={currentSymbol.triad} onChange={e => handleChange('triad', e.target.value)} className={INPUT_STYLE} placeholder="Triad" />
                                    <input type="text" value={currentSymbol.role} onChange={e => handleChange('role', e.target.value)} className={INPUT_STYLE} placeholder="Role" />
                                </div>
                            </section>
                            
                            <section className="bg-white dark:bg-gray-900 rounded-lg p-6 border border-gray-200 dark:border-gray-800 shadow-sm space-y-4">
                                <Label>Facets</Label>
                                <div className="grid grid-cols-2 gap-6">
                                    <input type="text" value={currentSymbol.facets?.function} onChange={e => handleFacetChange('function', e.target.value)} className={INPUT_STYLE} placeholder="Function" />
                                    <input type="text" value={currentSymbol.facets?.topology} onChange={e => handleFacetChange('topology', e.target.value)} className={INPUT_STYLE} placeholder="Topology" />
                                </div>
                            </section>

                            <section className="bg-white dark:bg-gray-900 rounded-lg p-6 border border-gray-200 dark:border-gray-800 shadow-sm space-y-4">
                                <Label>Symbolic Links</Label>
                                <SymbolRelationshipField items={currentSymbol.linked_patterns} onChange={links => handleChange('linked_patterns', links)} placeholder="Linked Symbols" />
                            </section>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
