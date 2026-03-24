
import React, { useState, useEffect, useRef } from 'react';
import { Plus, Check, AlertTriangle, GitMerge, Box, ArrowRightLeft, X, User, Database, RefreshCcw } from 'lucide-react';
import { SymbolDef } from '../../types';
import { Header, HeaderProps } from '../Header';

interface SymbolForgeScreenProps {
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


const INPUT_STYLE = "w-full bg-black/40 border border-gray-800 rounded p-2 text-sm focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-all text-gray-100 placeholder-gray-600";

const Label = ({ children }: { children?: React.ReactNode }) => (
    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 font-mono block mb-1">
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
            ref={textareaRef}
            value={value}
            onChange={onChange}
            rows={rows}
            placeholder={placeholder}
            disabled={disabled}
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

    if (copy.lattice && 'activation_conditions' in copy.lattice) {
        const { activation_conditions, ...rest } = copy.lattice;
        copy.lattice = rest;
    }
    if (copy.persona && 'activation_conditions' in copy.persona) {
        const { activation_conditions, ...rest } = copy.persona;
        copy.persona = rest;
    }

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
            if (typeof item === 'string') {
                return { id: item, link_type: 'relates_to', bidirectional: false };
            }
            return item;
        });
    } else {
        copy.linked_patterns = [];
    }

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

const SymbolRelationshipField = ({
    items,
    onChange,
    placeholder
}: {
    items: any[] | undefined,
    onChange: (newItems: any[]) => void,
    placeholder: string
}) => {
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
        if (symbolId) {
            const exists = safeItems.some(item => {
                const idStr = typeof item === 'object' ? item.id : item;
                return idStr === symbolId;
            });

            if (!exists) {
                const newItems = [
                    ...safeItems,
                    { id: symbolId, link_type: 'relates_to', bidirectional: false }
                ];
                onChange(newItems);
            }
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };

    return (
        <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            className="min-h-[60px] w-full bg-black/20 border-2 border-dashed border-gray-800 rounded-lg p-3 transition-colors hover:border-indigo-500/50"
        >
            {safeItems.length === 0 ? (
                <div className="h-full flex items-center justify-center text-[10px] text-gray-600 font-mono uppercase tracking-widest pointer-events-none">
                    {placeholder} (Drop Symbols)
                </div>
            ) : (
                <div className="space-y-2">
                    {(safeItems || []).map((item, idx) => {
                        const display = typeof item === 'object' ? (item.id || "Invalid Obj") : item;
                        const linkType = typeof item === 'object' ? item.link_type : 'relates_to';
                        const bidirectional = typeof item === 'object' ? !!item.bidirectional : false;

                        return (
                            <div key={`${display}-${idx}`} className="flex flex-wrap items-center gap-2 bg-gray-900 border border-gray-800 rounded-lg p-2 shadow-sm group">
                                <span className="text-[10px] font-mono font-bold text-indigo-400 min-w-[120px] truncate">{display}</span>
                                
                                <div className="h-4 w-[1px] bg-gray-800 hidden sm:block"></div>

                                <select 
                                    value={linkType}
                                    onChange={(e) => updateItem(idx, { link_type: e.target.value })}
                                    className="bg-black/40 border border-gray-800 rounded px-1.5 py-0.5 text-[9px] font-mono uppercase text-gray-400"
                                >
                                    <option value="relates_to">relates_to</option>
                                    <option value="depends_on">depends_on</option>
                                    <option value="instance_of">instance_of</option>
                                    <option value="part_of">part_of</option>
                                    <option value="evolved_from">evolved_from</option>
                                    <option value="conflicts_with">conflicts_with</option>
                                </select>

                                <button
                                    onClick={() => updateItem(idx, { bidirectional: !bidirectional })}
                                    title={bidirectional ? "Bidirectional" : "Unidirectional"}
                                    className={`p-1 rounded transition-colors ${bidirectional ? 'bg-emerald-900/20 text-emerald-400 border border-emerald-800/50' : 'bg-gray-800 text-gray-500'}`}
                                >
                                    <ArrowRightLeft size={10} />
                                </button>

                                <div className="flex-1"></div>

                                <button
                                    onClick={() => handleRemove(idx)}
                                    className="p-1 text-gray-600 hover:text-red-500 transition-colors"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};


export const SymbolForgeScreen: React.FC<SymbolForgeScreenProps> = ({ initialDomain, initialSymbol, headerProps }) => {
    const [domains, setDomains] = useState<string[]>([]);
    const [selectedDomain, setSelectedDomain] = useState<string>('');
    const [symbolList, setSymbolList] = useState<any[]>([]);
    const [currentSymbol, setCurrentSymbol] = useState<SymbolDef>(DEFAULT_PATTERN);
    const [originalId, setOriginalId] = useState<string | null>(null);
    const [isDirty, setIsDirty] = useState(false);
    const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const loadDomains = async () => {
        setIsLoading(true);
        try {
            const list = await window.api.listDomains();
            setDomains(list.sort());
            return list;
        } finally {
            setIsLoading(false);
        }
    };

    const handleRefresh = async () => {
        await loadDomains();
        if (selectedDomain) {
            const cached = await (window.api as any).getSymbolsByDomain(selectedDomain);
            setSymbolList(cached);
        }
    };

    useEffect(() => {
        const init = async () => {
            const localDomains = await loadDomains();
            let targetDomain = selectedDomain;

            if (initialSymbol?.symbol_domain && localDomains.includes(initialSymbol.symbol_domain)) {
                targetDomain = initialSymbol.symbol_domain;
            } else if (initialDomain && localDomains.includes(initialDomain)) {
                targetDomain = initialDomain;
            } else if (localDomains.length > 0 && !selectedDomain) {
                targetDomain = localDomains[0];
            }

            if (targetDomain) {
                setSelectedDomain(targetDomain);
                const cached = await (window.api as any).getSymbolsByDomain(targetDomain);
                setSymbolList(cached);
            }

            if (initialSymbol) {
                const sanitized = sanitizeForEditor(initialSymbol);
                setCurrentSymbol(sanitized);
                setOriginalId(initialSymbol.id);
                setIsDirty(false);
            }
        };
        init();
    }, [initialDomain, initialSymbol]);

    useEffect(() => {
        if (!selectedDomain) return;
        const loadSymbols = async () => {
            const cached = await (window.api as any).getSymbolsByDomain(selectedDomain);
            setSymbolList(cached);
        };
        loadSymbols();
    }, [selectedDomain]);

    const handleDragStart = (e: React.DragEvent, id: string) => {
        e.dataTransfer.setData("text/plain", id);
        e.dataTransfer.effectAllowed = "copy";
    };

    const handleSelectSymbol = async (id: string) => {
        const cached = await (window.api as any).getSymbolById(id);
        if (cached) {
            setCurrentSymbol(sanitizeForEditor(cached));
            setOriginalId(cached.id);
            setIsDirty(false);
        }
    };

    const handleSave = async () => {
        try {
            let targetDomain = currentSymbol.symbol_domain || selectedDomain || 'root';
            if (originalId && originalId !== currentSymbol.id) {
                await (window.api as any).deleteSymbol(targetDomain, originalId);
            }
            await window.api.upsertSymbol(targetDomain, currentSymbol);
            const updatedList = await (window.api as any).getSymbolsByDomain(targetDomain);
            setSymbolList(updatedList);
            setOriginalId(currentSymbol.id);
            setIsDirty(false);
            setSaveMessage({ type: 'success', text: 'Symbol Commited' });
        } catch (e) {
            setSaveMessage({ type: 'error', text: 'Commit Failed' });
        }
    };

    const handleNew = (template: SymbolDef) => {
        setCurrentSymbol({ 
            ...template, 
            symbol_domain: selectedDomain || 'root', 
            id: `NEW-${(template.kind || 'pattern').toUpperCase()}` 
        });
        setOriginalId(null);
        setIsDirty(false);
    };

    return (
        <div className="flex flex-col h-full bg-gray-950 font-sans relative">
            <Header {...headerProps}>
                <div className="flex items-center gap-4">
                    <button onClick={handleRefresh} className="flex items-center gap-2 px-3 py-1.5 bg-gray-900 hover:bg-gray-800 text-gray-300 rounded-md text-xs font-mono font-bold transition-colors border border-gray-800"><RefreshCcw size={14} className={isLoading ? "animate-spin" : ""} /> Refresh</button>
                    {saveMessage && <span className={`text-[10px] font-mono flex items-center gap-1 ${saveMessage.type === 'success' ? 'text-emerald-500' : 'text-amber-500'}`}>{saveMessage.type === 'success' ? <Check size={12} /> : <AlertTriangle size={12} />}{saveMessage.text}</span>}
                    <button onClick={handleSave} disabled={!isDirty} className="flex items-center gap-2 px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-mono text-[10px] font-bold uppercase tracking-widest transition-all shadow-lg shadow-indigo-500/10">Commit Symbol</button>
                </div>
            </Header>

            <div className="flex-1 flex overflow-hidden">
                <div className="w-80 border-r border-gray-800 flex flex-col shrink-0 bg-gray-950">
                    <div className="p-4 border-b border-gray-800">
                        <Label>Active_Domain</Label>
                        <select value={selectedDomain} onChange={(e) => setSelectedDomain(e.target.value)} className="w-full bg-black/40 border border-gray-800 rounded p-2 text-[11px] font-mono text-gray-300 uppercase tracking-tighter">
                            {(domains || []).map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 space-y-6">
                        {[{ label: 'Patterns', icon: Box, list: symbolList.filter(s => !s.kind || s.kind === 'pattern'), fn: () => handleNew(DEFAULT_PATTERN) },
                          { label: 'Lattices', icon: GitMerge, list: symbolList.filter(s => s.kind === 'lattice'), fn: () => handleNew(DEFAULT_LATTICE) },
                          { label: 'Personas', icon: User, list: symbolList.filter(s => s.kind === 'persona'), fn: () => handleNew(DEFAULT_PERSONA) },
                          { label: 'Data', icon: Database, list: symbolList.filter(s => s.kind === 'data'), fn: () => handleNew(DEFAULT_DATA) }
                        ].map(section => (
                            <div key={section.label}>
                                <div className="flex items-center justify-between px-2 pb-1 mb-2 border-b border-gray-900">
                                    <div className="text-[9px] font-mono font-bold uppercase text-gray-600 flex items-center gap-1 tracking-widest"><section.icon size={10} /> {section.label}</div>
                                    <button onClick={section.fn} className="text-gray-600 hover:text-indigo-400 p-1 rounded transition-colors"><Plus size={12} /></button>
                                </div>
                                {section.list.length === 0 ? (
                                    <div className="p-2 text-[9px] text-gray-700 font-mono italic uppercase tracking-widest">Empty_Stack</div>
                                ) : (
                                    section.list.map(sym => (
                                        <button key={sym.id} draggable onDragStart={(e) => handleDragStart(e, sym.id)} onClick={() => handleSelectSymbol(sym.id)} className={`w-full text-left p-2 rounded text-[10px] font-mono truncate transition-all mb-1 ${currentSymbol.id === sym.id ? 'bg-indigo-900/20 text-indigo-400 border border-indigo-800/50' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-900'}`}>{sym.id}</button>
                                    ))
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex-1 flex flex-col h-full overflow-hidden bg-gray-950/50">
                    <div className="flex-1 overflow-y-auto p-8">
                        <div className="max-w-4xl mx-auto space-y-8 pb-20">
                            <section className="bg-gray-900/40 rounded-2xl p-8 border border-gray-800 shadow-xl space-y-6">
                                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 font-mono border-b border-gray-800/50 pb-4 mb-4">Identity_Ontology</h3>
                                <div className="grid grid-cols-2 gap-8">
                                    <div className="space-y-2"><Label>Symbol_ID</Label><input type="text" value={currentSymbol.id} onChange={e => { setCurrentSymbol(p => ({...p, id: e.target.value})); setIsDirty(true); }} className={`${INPUT_STYLE} font-mono`} /></div>
                                    <div className="space-y-2"><Label>Display_Name</Label><input type="text" value={currentSymbol.name} onChange={e => { setCurrentSymbol(p => ({...p, name: e.target.value})); setIsDirty(true); }} className={INPUT_STYLE} /></div>
                                    <div className="space-y-2"><Label>Triad_Signature</Label><input type="text" value={currentSymbol.triad} onChange={e => { setCurrentSymbol(p => ({...p, triad: e.target.value})); setIsDirty(true); }} className={`${INPUT_STYLE} font-mono`} /></div>
                                    <div className="space-y-2"><Label>Functional_Role</Label><input type="text" value={currentSymbol.role} onChange={e => { setCurrentSymbol(p => ({...p, role: e.target.value})); setIsDirty(true); }} className={INPUT_STYLE} /></div>
                                </div>
                            </section>

                            <section className="bg-gray-900/40 rounded-2xl p-8 border border-gray-800 shadow-xl">
                                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 font-mono border-b border-gray-800/50 pb-4 mb-6">Activation_Logic</h3>
                                <Label>Macro_Command</Label>
                                <AutoResizeTextarea value={currentSymbol.macro || ''} onChange={(e: any) => { setCurrentSymbol(p => ({...p, macro: e.target.value})); setIsDirty(true); }} className={`${INPUT_STYLE} font-mono mb-6`} placeholder="LOAD -> EXECUTE -> EMIT" />
                                <Label>Activation_Conditions</Label>
                                <AutoResizeTextarea value={safeJoin(currentSymbol.activation_conditions, '\n')} onChange={(e: any) => { setCurrentSymbol(p => ({...p, activation_conditions: e.target.value.split('\n').filter(s => s.trim())})); setIsDirty(true); }} className={`${INPUT_STYLE} font-mono`} placeholder="CONDITION_ALPHA" />
                            </section>

                            <section className="bg-gray-900/40 rounded-2xl p-8 border border-gray-800 shadow-xl space-y-6">
                                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 font-mono border-b border-gray-800/50 pb-4 mb-4">Relational_Map</h3>
                                <SymbolRelationshipField items={currentSymbol.linked_patterns} onChange={(newItems) => { setCurrentSymbol(p => ({...p, linked_patterns: newItems})); setIsDirty(true); }} placeholder="Orphan_Symbol" />
                            </section>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
