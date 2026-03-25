import { describe, it, expect } from 'vitest';
import { SymbolDef } from '../types';

// We extract the logic to test it in isolation
// In a real scenario, this would be imported from a shared utils file
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

describe('SymbolForge Logic (sanitizeForEditor)', () => {
    it('should hydrate missing basic fields', () => {
        const raw = { id: 'TEST' };
        const sanitized = sanitizeForEditor(raw);
        expect(sanitized.kind).toBe('pattern');
        expect(sanitized.name).toBe('');
        expect(sanitized.symbol_tag).toBe('');
        expect(sanitized.facets).toBeDefined();
        expect(sanitized.linked_patterns).toEqual([]);
    });

    it('should merge activation conditions from nested structures and de-duplicate', () => {
        const raw = {
            id: 'TEST',
            activation_conditions: ['A', 'B'],
            lattice: {
                activation_conditions: ['B', 'C']
            },
            persona: {
                activation_conditions: ['D']
            },
            data: {
                activation_conditions: ['E']
            }
        };
        const sanitized = sanitizeForEditor(raw);
        expect(sanitized.activation_conditions).toEqual(['A', 'B', 'C', 'D', 'E']);
        expect((sanitized.lattice as any)?.activation_conditions).toBeUndefined();
        expect((sanitized.persona as any)?.activation_conditions).toBeUndefined();
        expect((sanitized.data as any)?.activation_conditions).toBeUndefined();
    });

    it('should normalize linked_patterns from strings to objects', () => {
        const raw = {
            id: 'TEST',
            linked_patterns: ['SYM-1', { id: 'SYM-2', link_type: 'depends_on' }]
        };
        const sanitized = sanitizeForEditor(raw);
        expect(sanitized.linked_patterns[0]).toEqual({ id: 'SYM-1', link_type: 'relates_to', bidirectional: false });
        expect(sanitized.linked_patterns[1]).toEqual({ id: 'SYM-2', link_type: 'depends_on' });
    });

    it('should hydrate lattice fields for lattice symbols', () => {
        const raw = { id: 'LAT-1', kind: 'lattice' };
        const sanitized = sanitizeForEditor(raw);
        expect(sanitized.lattice).toBeDefined();
        expect(sanitized.lattice?.topology).toBe('inductive');
    });

    it('should hydrate persona fields for persona symbols', () => {
        const raw = { id: 'PER-1', kind: 'persona' };
        const sanitized = sanitizeForEditor(raw);
        expect(sanitized.persona).toBeDefined();
        expect(sanitized.persona?.recursion_level).toBe('root');
    });

    it('should hydrate data fields for data symbols', () => {
        const raw = { id: 'DAT-1', kind: 'data' };
        const sanitized = sanitizeForEditor(raw);
        expect(sanitized.data).toBeDefined();
        expect(sanitized.data?.source).toBe('manual');
        expect(sanitized.data?.payload).toEqual({});
    });
});
