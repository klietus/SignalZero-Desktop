
import React, { useState, useEffect, useRef } from 'react';
import { Plus, Check, AlertTriangle, GitMerge, Box, ArrowRightLeft, X, User, Database, RefreshCcw, Layout } from 'lucide-react';
import { SymbolDef, SymbolFacet } from '../../types';
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
        ...(Array.isArray(copy.data?.activation_conditions) ? copy.data.activation_conditions : []),
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
    if (copy.data && 'activation_conditions' in copy.data) {
        const { activation_conditions, ...rest } = copy.data;
        copy.data = rest;
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
                                    <optgroup label="General">
                                        <option value="relates_to">relates_to</option>
                                    </optgroup>
                                    <optgroup label="Requirements">
                                        <option value="depends_on">depends_on</option>
                                        <option value="required_by">required_by</option>
                                    </optgroup>
                                    <optgroup label="Composition">
                                        <option value="part_of">part_of</option>
                                        <option value="contains">contains</option>
                                    </optgroup>
                                    <optgroup label="Abstraction">
                                        <option value="instance_of">instance_of</option>
                                        <option value="exemplifies">exemplifies</option>
                                    </optgroup>
                                    <optgroup label="Flow">
                                        <option value="informs">informs</option>
                                        <option value="informed_by">informed_by</option>
                                    </optgroup>
                                    <optgroup label="Constraints">
                                        <option value="constrained_by">constrained_by</option>
                                        <option value="limits">limits</option>
                                    </optgroup>
                                    <optgroup label="Causal">
                                        <option value="triggers">triggers</option>
                                        <option value="triggered_by">triggered_by</option>
                                    </optgroup>
                                    <optgroup label="Logic">
                                        <option value="negates">negates</option>
                                        <option value="negated_by">negated_by</option>
                                    </optgroup>
                                    <optgroup label="Evolution">
                                        <option value="evolved_from">evolved_from</option>
                                        <option value="evolved_into">evolved_into</option>
                                    </optgroup>
                                    <optgroup label="Implementation">
                                        <option value="implements">implements</option>
                                        <option value="implemented_by">implemented_by</option>
                                    </optgroup>
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
    const [payloadText, setPayloadText] = useState("{}");

    // Sync Payload Text when symbol changes (external load)
    useEffect(() => {
        if (currentSymbol.kind === 'data' && currentSymbol.data?.payload) {
            setPayloadText(JSON.stringify(currentSymbol.data.payload, null, 2));
        }
    }, [currentSymbol.id, currentSymbol.kind]);

    const handleChange = (field: keyof SymbolDef, value: any) => {
        setCurrentSymbol(prev => ({ ...prev, [field]: value }));
        setIsDirty(true);
    };

    const handleFacetChange = (field: keyof SymbolFacet, value: any) => {
        setCurrentSymbol(prev => ({
            ...prev,
            facets: {
                ...(prev.facets || DEFAULT_PATTERN.facets),
                [field]: value
            }
        }));
        setIsDirty(true);
    };

    const handleLatticeChange = (field: string, value: any) => {
        if (!currentSymbol.lattice) return;
        setCurrentSymbol(prev => ({
            ...prev,
            lattice: {
                ...prev.lattice!,
                [field]: value
            }
        }));
        setIsDirty(true);
    }

    const handlePersonaChange = (field: string, value: any) => {
        if (!currentSymbol.persona) return;
        setCurrentSymbol(prev => ({
            ...prev,
            persona: {
                ...prev.persona!,
                [field]: value
            }
        }));
        setIsDirty(true);
    }

    const handleDataChange = (field: string, value: any) => {
        if (!currentSymbol.data) return;
        setCurrentSymbol(prev => ({
            ...prev,
            data: {
                ...prev.data!,
                [field]: value
            }
        }));
        setIsDirty(true);
    }

    const handleArrayChange = (root: string, field: string, value: string) => {
        const items = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
        if (root === 'facets') {
            handleFacetChange(field as keyof SymbolFacet, items);
        }
    };

    const handleLinesArrayChange = (root: string, field: string, value: string) => {
        const items = value.split('\n').map(s => s.trim()).filter(s => s.length > 0);
        if (root === 'root') {
            handleChange(field as keyof SymbolDef, items);
        } else if (root === 'persona') {
            handlePersonaChange(field, items);
        }
    };

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
        if (isDirty) {
            if (!window.confirm("Unsaved changes detected. Abandon Forge state?")) return;
        }
        setSaveMessage(null);

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
        if (isDirty) {
            if (!window.confirm("Unsaved changes detected. Abandon Forge state?")) return;
        }
        setSaveMessage(null);

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
                            {/* Identity Section (Common) */}
                            <section className="bg-gray-900/40 rounded-2xl p-8 border border-gray-800 shadow-xl space-y-6">
                                <div className="flex items-center justify-between border-b border-gray-800/50 pb-4 mb-4">
                                    <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 font-mono">Identity_Ontology</h3>
                                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider font-mono ${currentSymbol.kind === 'lattice'
                                        ? 'bg-purple-900/30 text-purple-400 border border-purple-800/50'
                                        : currentSymbol.kind === 'persona'
                                            ? 'bg-amber-900/30 text-amber-400 border border-amber-800/50'
                                            : currentSymbol.kind === 'data'
                                                ? 'bg-blue-900/30 text-blue-400 border border-blue-800/50'
                                                : 'bg-indigo-900/30 text-indigo-400 border border-indigo-800/50'
                                        }`}>
                                        {currentSymbol.kind || 'Pattern'}
                                    </span>
                                </div>

                                <div className="grid grid-cols-2 gap-8">
                                    <div className="space-y-2">
                                        <Label>Symbol_ID (Unique)</Label>
                                        <input
                                            type="text"
                                            value={currentSymbol.id}
                                            onChange={e => handleChange('id', e.target.value)}
                                            className={`${INPUT_STYLE} font-mono`}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Display_Name</Label>
                                        <input
                                            type="text"
                                            value={currentSymbol.name}
                                            onChange={e => handleChange('name', e.target.value)}
                                            className={INPUT_STYLE}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Triad_Signature</Label>
                                        <input
                                            type="text"
                                            value={currentSymbol.triad}
                                            onChange={e => handleChange('triad', e.target.value)}
                                            className={`${INPUT_STYLE} font-mono`}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Functional_Role</Label>
                                        <input
                                            type="text"
                                            value={currentSymbol.role}
                                            onChange={e => handleChange('role', e.target.value)}
                                            className={INPUT_STYLE}
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-8 pt-2">
                                    <div className="space-y-2">
                                        <Label>Domain_Scope</Label>
                                        <input
                                            type="text"
                                            value={currentSymbol.symbol_domain}
                                            disabled
                                            className={`${INPUT_STYLE} opacity-50 cursor-not-allowed font-mono`}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Symbol_Tag</Label>
                                        <input
                                            type="text"
                                            value={currentSymbol.symbol_tag || ''}
                                            onChange={e => handleChange('symbol_tag', e.target.value)}
                                            className={INPUT_STYLE}
                                        />
                                    </div>
                                </div>
                            </section>

                            {/* Activation Conditions (Common) */}
                            <section className="bg-gray-900/40 rounded-2xl p-8 border border-gray-800 shadow-xl space-y-4">
                                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 font-mono border-b border-gray-800/50 pb-4 mb-4">
                                    Activation_Logic
                                </h3>
                                <div className="grid grid-cols-1 gap-6">
                                    <div className="space-y-1">
                                        <Label>Symbol_Activation_Conditions</Label>
                                        <AutoResizeTextarea
                                            value={safeJoin(currentSymbol.activation_conditions, '\n')}
                                            onChange={(e: any) => handleLinesArrayChange('root', 'activation_conditions', e.target.value)}
                                            placeholder="One condition per line..."
                                            className={`${INPUT_STYLE} font-mono`}
                                        />
                                    </div>
                                </div>
                            </section>

                            {/* LATTICE SECTION */}
                            {currentSymbol.kind === 'lattice' && (
                                <section className="bg-purple-900/10 rounded-2xl p-8 border border-purple-800/30 shadow-xl space-y-6">
                                    <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-purple-400 font-mono border-b border-purple-800/30 pb-4 mb-4 flex items-center gap-2">
                                        <Layout size={14} /> Lattice_Definition
                                    </h3>
                                    <div className="grid grid-cols-2 gap-8">
                                        <div className="space-y-2">
                                            <Label>Execution_Topology</Label>
                                            <select
                                                value={currentSymbol.lattice?.topology || 'inductive'}
                                                onChange={e => handleLatticeChange('topology', e.target.value)}
                                                className={INPUT_STYLE}
                                            >
                                                <option value="inductive">Inductive (Bottom-Up)</option>
                                                <option value="deductive">Deductive (Top-Down)</option>
                                                <option value="bidirectional">Bidirectional (Flow)</option>
                                                <option value="invariant">Invariant (Constraint)</option>
                                                <option value="energy">Energy (State)</option>
                                            </select>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Closure_Type</Label>
                                            <select
                                                value={currentSymbol.lattice?.closure || 'agent'}
                                                onChange={e => handleLatticeChange('closure', e.target.value)}
                                                className={INPUT_STYLE}
                                            >
                                                <option value="agent">Agent (Recursive)</option>
                                                <option value="branch">Branch (Forking)</option>
                                                <option value="collapse">Collapse (Reduction)</option>
                                                <option value="constellation">Constellation (Graph)</option>
                                                <option value="synthesis">Synthesis (Merge)</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Lattice_Members (Execution_Order)</Label>
                                        <SymbolRelationshipField
                                            items={currentSymbol.linked_patterns}
                                            onChange={(newItems) => handleChange('linked_patterns', newItems)}
                                            placeholder="No_Members_Assigned"
                                        />
                                    </div>
                                </section>
                            )}

                            {/* PERSONA SECTION */}
                            {currentSymbol.kind === 'persona' && (
                                <section className="bg-amber-900/10 rounded-2xl p-8 border border-amber-800/30 shadow-xl space-y-6">
                                    <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400 font-mono border-b border-amber-800/30 pb-4 mb-4 flex items-center gap-2">
                                        <User size={14} /> Persona_Definition
                                    </h3>

                                    <div className="grid grid-cols-2 gap-8">
                                        <div className="space-y-2">
                                            <Label>Recursion_Level</Label>
                                            <select
                                                value={currentSymbol.persona?.recursion_level || 'root'}
                                                onChange={e => handlePersonaChange('recursion_level', e.target.value)}
                                                className={INPUT_STYLE}
                                            >
                                                <option value="root">Root</option>
                                                <option value="recursive">Recursive</option>
                                                <option value="fractal">Fractal</option>
                                            </select>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Persona_Function</Label>
                                            <input
                                                value={currentSymbol.persona?.function || ''}
                                                onChange={e => handlePersonaChange('function', e.target.value)}
                                                className={INPUT_STYLE}
                                                placeholder="Primary function of this persona"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <div className="space-y-2">
                                            <Label>Fallback_Behavior</Label>
                                            <AutoResizeTextarea
                                                value={safeJoin(currentSymbol.persona?.fallback_behavior, '\n')}
                                                onChange={(e: any) => handleLinesArrayChange('persona', 'fallback_behavior', e.target.value)}
                                                placeholder="One behavior per line..."
                                                className={INPUT_STYLE}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Linked_Personas</Label>
                                            <SymbolRelationshipField
                                                items={currentSymbol.persona?.linked_personas}
                                                onChange={(newItems) => handlePersonaChange('linked_personas', newItems)}
                                                placeholder="No_Linked_Personas"
                                            />
                                        </div>
                                    </div>
                                </section>
                            )}

                            {/* DATA SECTION */}
                            {currentSymbol.kind === 'data' && (
                                <section className="bg-blue-900/10 rounded-2xl p-8 border border-blue-800/30 shadow-xl space-y-6">
                                    <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-400 font-mono border-b border-blue-800/30 pb-4 mb-4 flex items-center gap-2">
                                        <Database size={14} /> Data_Definition
                                    </h3>

                                    <div className="grid grid-cols-3 gap-8">
                                        <div className="space-y-2">
                                            <Label>Data_Source</Label>
                                            <input
                                                value={currentSymbol.data?.source || ''}
                                                onChange={e => handleDataChange('source', e.target.value)}
                                                className={INPUT_STYLE}
                                                placeholder="e.g. manual, api, sensor"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Verification_Tier</Label>
                                            <select
                                                value={currentSymbol.data?.verification || 'unverified'}
                                                onChange={e => handleDataChange('verification', e.target.value)}
                                                className={INPUT_STYLE}
                                            >
                                                <option value="unverified">Unverified</option>
                                                <option value="verified">Verified</option>
                                                <option value="signed">Signed</option>
                                                <option value="consensus">Consensus</option>
                                            </select>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Lifecycle_Status</Label>
                                            <select
                                                value={currentSymbol.data?.status || 'active'}
                                                onChange={e => handleDataChange('status', e.target.value)}
                                                className={INPUT_STYLE}
                                            >
                                                <option value="active">Active</option>
                                                <option value="archived">Archived</option>
                                                <option value="deprecated">Deprecated</option>
                                                <option value="provisional">Provisional</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Payload_Buffer (JSON)</Label>
                                        <AutoResizeTextarea
                                            value={payloadText}
                                            onChange={(e: any) => setPayloadText(e.target.value)}
                                            onBlur={(e: any) => {
                                                try {
                                                    const parsed = JSON.parse(e.target.value);
                                                    handleDataChange('payload', parsed);
                                                    setPayloadText(JSON.stringify(parsed, null, 2));
                                                } catch (err) {
                                                    console.error("Invalid JSON Payload");
                                                }
                                            }}
                                            className={`${INPUT_STYLE} font-mono text-[10px] min-h-[100px]`}
                                            placeholder="{}"
                                        />
                                        <div className="text-[9px] text-gray-600 font-mono italic uppercase">Buffer_Requires_Valid_JSON</div>
                                    </div>
                                </section>
                            )}

                            {/* Macro Logic (For Patterns primarily) */}
                            {currentSymbol.kind !== 'lattice' && (
                                <section className="bg-gray-900/40 rounded-2xl p-8 border border-gray-800 shadow-xl space-y-4">
                                    <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 font-mono border-b border-gray-800/50 pb-4 mb-4">
                                        Functional_Logic
                                    </h3>
                                    <div className="space-y-2">
                                        <Label>Macro_Command (Logic_Flow)</Label>
                                        <AutoResizeTextarea
                                            value={currentSymbol.macro || ''}
                                            onChange={(e: any) => handleChange('macro', e.target.value)}
                                            className={`${INPUT_STYLE} font-mono`}
                                            placeholder="LOAD -> EXECUTE -> EMIT"
                                        />
                                    </div>
                                </section>
                            )}

                            {/* Facets */}
                            <section className="bg-gray-900/40 rounded-2xl p-8 border border-gray-800 shadow-xl space-y-6">
                                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 font-mono border-b border-gray-800/50 pb-4 mb-4">
                                    Operational_Facets
                                </h3>
                                <div className="grid grid-cols-2 gap-8">
                                    <div className="space-y-2">
                                        <Label>Facet_Function</Label>
                                        <input
                                            type="text"
                                            value={currentSymbol.facets?.function || ''}
                                            onChange={e => handleFacetChange('function', e.target.value)}
                                            className={INPUT_STYLE}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Facet_Topology</Label>
                                        <input
                                            type="text"
                                            value={currentSymbol.facets?.topology || ''}
                                            onChange={e => handleFacetChange('topology', e.target.value)}
                                            className={INPUT_STYLE}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Commit_Type</Label>
                                        <input
                                            type="text"
                                            value={currentSymbol.facets?.commit || ''}
                                            onChange={e => handleFacetChange('commit', e.target.value)}
                                            className={INPUT_STYLE}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Temporal_Axis</Label>
                                        <input
                                            type="text"
                                            value={currentSymbol.facets?.temporal || ''}
                                            onChange={e => handleFacetChange('temporal', e.target.value)}
                                            className={INPUT_STYLE}
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-4">
                                    <div className="space-y-2">
                                        <Label>Invariants (CSV)</Label>
                                        <input
                                            type="text"
                                            value={safeJoin(currentSymbol.facets?.invariants, ', ')}
                                            onChange={e => handleArrayChange('facets', 'invariants', e.target.value)}
                                            className={INPUT_STYLE}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Substrate (CSV)</Label>
                                        <input
                                            type="text"
                                            value={safeJoin(currentSymbol.facets?.substrate, ', ')}
                                            onChange={e => handleArrayChange('facets', 'substrate', e.target.value)}
                                            className={INPUT_STYLE}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Gate_Logic (CSV)</Label>
                                        <input
                                            type="text"
                                            value={safeJoin(currentSymbol.facets?.gate, ', ')}
                                            onChange={e => handleArrayChange('facets', 'gate', e.target.value)}
                                            className={INPUT_STYLE}
                                        />
                                    </div>
                                </div>
                            </section>

                            {/* Integrity */}
                            <section className="bg-red-900/10 rounded-2xl p-8 border border-red-900/30 shadow-xl space-y-4">
                                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-400 font-mono border-b border-red-900/30 pb-4 mb-4">
                                    System_Integrity
                                </h3>
                                <div className="space-y-2">
                                    <Label>Failure_Mode</Label>
                                    <AutoResizeTextarea
                                        value={currentSymbol.failure_mode || ''}
                                        onChange={(e: any) => handleChange('failure_mode', e.target.value)}
                                        className={`${INPUT_STYLE} border-red-900/50 bg-red-950/20`}
                                        placeholder="Describe how this symbol fails..."
                                    />
                                </div>
                            </section>

                            {/* Relational Map (Generic) */}
                            {currentSymbol.kind !== 'lattice' && (
                                <section className="bg-gray-900/40 rounded-2xl p-8 border border-gray-800 shadow-xl space-y-6">
                                    <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 font-mono border-b border-gray-800/50 pb-4 mb-4">Relational_Map</h3>
                                    <SymbolRelationshipField items={currentSymbol.linked_patterns} onChange={(newItems) => handleChange('linked_patterns', newItems)} placeholder="Orphan_Symbol" />
                                </section>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
