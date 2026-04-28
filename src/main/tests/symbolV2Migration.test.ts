import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sqliteService } from '../services/sqliteService.js';
import { domainService } from '../services/domainService.js';
import { lancedbService } from '../services/lancedbService.js';
import { eventBusService } from '../services/eventBusService.js';
import { migrateToV2, migrateFromV2, computeRecencyWeight, decayRecencyWeight, isSymbolStale, isLinkStale, recordLinkAccess, checkLinkPromotion, checkForgetting } from '../services/symbolV2Migration.js';
import { SymbolDefV2, SymbolDef, CommitType } from '../types.js';

vi.mock('../services/lancedbService.js', () => ({
    lancedbService: {
        indexBatch: vi.fn().mockResolvedValue(0),
        embedTexts: vi.fn().mockResolvedValue([]),
    }
}));

vi.mock('../services/eventBusService.js', () => ({
    eventBusService: {
        emitKernelEvent: vi.fn(),
    },
    KernelEventType: {}
}));

describe('symbolV2Migration — migrateToV2', () => {
    it('should convert a v1 symbol to v2 format', () => {
        const v1: SymbolDef = {
            id: 'TEST-SYM',
            name: 'Test Symbol',
            kind: 'pattern',
            created_at: '2026-04-27',
            updated_at: '2026-04-27',
            triad: '🧩🔄💎',
            role: 'test role',
            macro: 'INPUT -> PROCESS -> OUTPUT',
            activation_conditions: ['trigger_a', 'trigger_b'],
            symbol_domain: 'test_domain',
            symbol_tag: 'tag1, tag2',
            facets: {
                function: 'test',
                topology: 'inductive',
                commit: 'volatile',
                temporal: 'ephemeral',
                gate: [],
                substrate: ['core'],
                invariants: ['inv1'],
            },
            failure_mode: 'timeout',
            linked_patterns: [
                { id: 'LINK-TARGET', link_type: 'depends_on' },
                { id: 'LINK-TARGET-2', link_type: 'part_of' },
            ],
        };

        const v2 = migrateToV2(v1);

        expect(v2.id).toBe('TEST-SYM');
        expect(v2.v2).toBe(true);
        expect(v2.schema_version).toBe(2);
        expect(v2.commit).toBe('volatile');
        expect(v2.recency_weight).toBe(1.0);
        expect(v2.links).toHaveLength(2);
        expect(v2.links[0].id).toBe('LINK-TARGET');
        expect(v2.links[0].link_type).toBe('depends_on');
        expect(v2.links[0].access_count).toBe(0);
        expect(v2.links[0].access_ema).toBe(0.0);
        expect(v2.predicates.function).toContain('test');
        expect(v2.predicates.topology).toContain('inductive');
        expect(v2.predicates.temporal).toContain('ephemeral');
        expect(v2.predicates.tags).toContain('tag1');
        expect(v2.predicates.tags).toContain('tag2');
        expect(v2.predicates.kind).toContain('pattern');
    });

    it('should set commit to foundational when facets.commit is foundational', () => {
        const v1: SymbolDef = {
            id: 'FOUND-SYM',
            name: 'Foundational',
            kind: 'pattern',
            created_at: '2026-04-27',
            updated_at: '2026-04-27',
            triad: '🏛️🔗💎',
            role: 'anchor',
            macro: 'INPUT -> PROCESS -> OUTPUT',
            activation_conditions: [],
            symbol_domain: 'root',
            symbol_tag: 'core',
            facets: {
                function: 'anchor',
                topology: 'invariant',
                commit: 'foundational',
                temporal: 'persistent',
                gate: [],
                substrate: ['core'],
                invariants: ['non-coercion'],
            },
            failure_mode: 'unavailable',
            linked_patterns: [],
        };

        const v2 = migrateToV2(v1);
        expect(v2.commit).toBe('foundational');
    });

    it('should handle symbol with no linked_patterns', () => {
        const v1: SymbolDef = {
            id: 'NO-LINKS',
            name: 'No Links',
            kind: 'pattern',
            created_at: '2026-04-27',
            updated_at: '2026-04-27',
            triad: '🔹',
            role: 'standalone',
            macro: 'INPUT -> OUTPUT',
            activation_conditions: [],
            symbol_domain: 'test',
            symbol_tag: '',
            facets: {
                function: 'test',
                topology: 'inductive',
                commit: 'volatile',
                temporal: 'ephemeral',
                gate: [],
                substrate: [],
                invariants: [],
            },
            failure_mode: 'none',
            linked_patterns: [],
        };

        const v2 = migrateToV2(v1);
        expect(v2.links).toHaveLength(0);
    });
});

describe('symbolV2Migration — migrateFromV2', () => {
    it('should convert a v2 symbol back to v1 format', () => {
        const now = Date.now();
        const v2: SymbolDefV2 = {
            id: 'V2-SYM',
            name: 'V2 Symbol',
            kind: 'lattice',
            created_at: '2026-04-27',
            updated_at: '2026-04-27',
            triad: '🌐🔄💎',
            role: 'lattice anchor',
            macro: 'INPUT -> PROCESS -> OUTPUT',
            activation_conditions: ['trigger'],
            symbol_domain: 'test',
            symbol_tag: 'lattice',
            facets: {
                function: 'lattice',
                topology: 'constellation',
                commit: 'foundational',
                temporal: 'persistent',
                gate: [],
                substrate: ['core'],
                invariants: ['inv1'],
            },
            failure_mode: 'collapse',
            linked_patterns: [],
            commit: 'foundational',
            recency_weight: 1.0,
            last_updated_epoch: now,
            predicates: { function: ['lattice'] },
            links: [
                { id: 'L1', link_type: 'relates_to', access_count: 5, access_ema: 0.3, last_accessed: new Date().toISOString(), committed: 'volatile', created_at: new Date().toISOString() },
            ],
            v2: true,
            schema_version: 2,
        };

        const v1 = migrateFromV2(v2);

        expect(v1.id).toBe('V2-SYM');
        expect(v1.linked_patterns).toHaveLength(1);
        expect(v1.linked_patterns![0].id).toBe('L1');
        expect(v1.linked_patterns![0].link_type).toBe('relates_to');
        expect(v1.facets.commit).toBe('foundational');
    });
});

describe('symbolV2Migration — computeRecencyWeight', () => {
    it('should return 1.0 for foundational symbols', () => {
        const weight = computeRecencyWeight(Date.now(), 'foundational');
        expect(weight).toBe(1.0);
    });

    it('should return 1.0 for freshly updated volatile symbols', () => {
        const weight = computeRecencyWeight(Date.now(), 'volatile');
        expect(weight).toBeCloseTo(1.0, 10);
    });

    it('should decay weight over time', () => {
        const past = Date.now() - (24 * 60 * 60 * 1000); // 1 day ago
        const weight = computeRecencyWeight(past, 'volatile');
        expect(weight).toBeLessThan(1.0);
        expect(weight).toBeGreaterThan(0.8);
    });

    it('should decay significantly for old symbols', () => {
        const past = Date.now() - (30 * 24 * 60 * 60 * 1000); // 30 days ago
        const weight = computeRecencyWeight(past, 'volatile');
        expect(weight).toBeLessThan(0.3);
    });

    it('should not go below 0', () => {
        const ancient = Date.now() - (365 * 24 * 60 * 60 * 1000); // 1 year ago
        const weight = computeRecencyWeight(ancient, 'volatile');
        expect(weight).toBeGreaterThanOrEqual(0);
    });
});

describe('symbolV2Migration — decayRecencyWeight', () => {
    it('should decay weight by elapsed hours', () => {
        const weight = decayRecencyWeight(1.0, 24); // 24 hours
        expect(weight).toBeLessThan(1.0);
        expect(weight).toBeGreaterThan(0.8);
    });

    it('should decay more over longer periods', () => {
        const weight = decayRecencyWeight(1.0, 168); // 1 week
        expect(weight).toBeLessThan(0.5);
    });

    it('should not go below 0', () => {
        const weight = decayRecencyWeight(1.0, 8760); // 1 year
        expect(weight).toBeCloseTo(0, 5);
    });
});

describe('symbolV2Migration — isSymbolStale', () => {
    it('should not be stale for foundational symbols', () => {
        const symbol: SymbolDefV2 = {
            id: 'FOUND',
            name: 'Foundational',
            kind: 'pattern',
            created_at: '2026-01-01',
            updated_at: '2026-01-01',
            triad: '🏛️',
            role: 'anchor',
            macro: 'INPUT -> OUTPUT',
            activation_conditions: [],
            symbol_domain: 'root',
            symbol_tag: '',
            facets: { function: 'test', topology: 'test', commit: 'test', temporal: 'test', gate: [], substrate: [], invariants: [] },
            failure_mode: 'none',
            linked_patterns: [],
            commit: 'foundational',
            recency_weight: 0.01,
            last_updated_epoch: Date.now() - (365 * 24 * 60 * 60 * 1000),
            predicates: {},
            links: [],
            v2: true,
            schema_version: 2,
        };
        expect(isSymbolStale(symbol)).toBe(false);
    });

    it('should be stale when recency_weight < 0.1', () => {
        const symbol: SymbolDefV2 = {
            id: 'STALE',
            name: 'Stale',
            kind: 'pattern',
            created_at: '2026-01-01',
            updated_at: '2026-01-01',
            triad: '💨',
            role: 'volatile',
            macro: 'INPUT -> OUTPUT',
            activation_conditions: [],
            symbol_domain: 'test',
            symbol_tag: '',
            facets: { function: 'test', topology: 'test', commit: 'volatile', temporal: 'test', gate: [], substrate: [], invariants: [] },
            failure_mode: 'none',
            linked_patterns: [],
            commit: 'volatile',
            recency_weight: 0.05,
            last_updated_epoch: Date.now(),
            predicates: {},
            links: [],
            v2: true,
            schema_version: 2,
        };
        expect(isSymbolStale(symbol)).toBe(true);
    });

    it('should be stale when older than 30 days', () => {
        const symbol: SymbolDefV2 = {
            id: 'OLD',
            name: 'Old',
            kind: 'pattern',
            created_at: '2026-01-01',
            updated_at: '2026-01-01',
            triad: '🌋',
            role: 'old',
            macro: 'INPUT -> OUTPUT',
            activation_conditions: [],
            symbol_domain: 'test',
            symbol_tag: '',
            facets: { function: 'test', topology: 'test', commit: 'volatile', temporal: 'test', gate: [], substrate: [], invariants: [] },
            failure_mode: 'none',
            linked_patterns: [],
            commit: 'volatile',
            recency_weight: 0.5,
            last_updated_epoch: Date.now() - (31 * 24 * 60 * 60 * 1000),
            predicates: {},
            links: [],
            v2: true,
            schema_version: 2,
        };
        expect(isSymbolStale(symbol)).toBe(true);
    });
});

describe('symbolV2Migration — isLinkStale', () => {
    it('should not be stale for foundational links', () => {
        const link = {
            id: 'L1',
            link_type: 'relates_to',
            access_count: 0,
            access_ema: 0,
            last_accessed: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
            committed: 'foundational' as CommitType,
            created_at: new Date().toISOString(),
        };
        expect(isLinkStale(link)).toBe(false);
    });

    it('should be stale when ema < 0.1 and no access for 7 days', () => {
        const link = {
            id: 'L2',
            link_type: 'relates_to',
            access_count: 0,
            access_ema: 0.05,
            last_accessed: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
            committed: 'volatile' as CommitType,
            created_at: new Date().toISOString(),
        };
        expect(isLinkStale(link)).toBe(true);
    });

    it('should not be stale with high ema', () => {
        const link = {
            id: 'L3',
            link_type: 'relates_to',
            access_count: 10,
            access_ema: 0.5,
            last_accessed: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
            committed: 'volatile' as CommitType,
            created_at: new Date().toISOString(),
        };
        expect(isLinkStale(link)).toBe(false);
    });
});

describe('symbolV2Migration — recordLinkAccess', () => {
    it('should increment access count and ema', () => {
        const link = {
            id: 'L1',
            link_type: 'relates_to',
            access_count: 0,
            access_ema: 0,
            last_accessed: new Date().toISOString(),
            committed: 'volatile' as CommitType,
            created_at: new Date().toISOString(),
        };

        const result = recordLinkAccess(link);
        expect(result.access_count).toBe(1);
        expect(result.access_ema).toBe(0.1);
        expect(result.last_accessed).toBeDefined();
    });

    it('should accumulate ema correctly', () => {
        const link = {
            id: 'L1',
            link_type: 'relates_to',
            access_count: 10,
            access_ema: 0.5,
            last_accessed: new Date().toISOString(),
            committed: 'volatile' as CommitType,
            created_at: new Date().toISOString(),
        };

        const result = recordLinkAccess(link);
        expect(result.access_count).toBe(11);
        expect(result.access_ema).toBeCloseTo(0.55, 2);
    });
});

describe('symbolV2Migration — checkLinkPromotion', () => {
    it('should promote high-access links', () => {
        const link = {
            id: 'L1',
            link_type: 'relates_to',
            access_count: 60,
            access_ema: 0.5,
            last_accessed: new Date().toISOString(),
            committed: 'volatile' as CommitType,
            created_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), // 2 days ago
        };
        expect(checkLinkPromotion(link)).toBe(true);
    });

    it('should not promote low-access links', () => {
        const link = {
            id: 'L2',
            link_type: 'relates_to',
            access_count: 5,
            access_ema: 0.05,
            last_accessed: new Date().toISOString(),
            committed: 'volatile' as CommitType,
            created_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        };
        expect(checkLinkPromotion(link)).toBe(false);
    });

    it('should not promote links with low ema despite high access count', () => {
        const link = {
            id: 'L3',
            link_type: 'relates_to',
            access_count: 100,
            access_ema: 0.1,
            last_accessed: new Date().toISOString(),
            committed: 'volatile' as CommitType,
            created_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), // 2 days ago
        };
        expect(checkLinkPromotion(link)).toBe(false);
    });
});

describe('symbolV2Migration — checkForgetting', () => {
    it('should exempt foundational symbols', () => {
        const symbol: SymbolDefV2 = {
            id: 'FOUND',
            name: 'Foundational',
            kind: 'pattern',
            created_at: '2026-01-01',
            updated_at: '2026-01-01',
            triad: '🏛️',
            role: 'anchor',
            macro: 'INPUT -> OUTPUT',
            activation_conditions: [],
            symbol_domain: 'root',
            symbol_tag: '',
            facets: { function: 'test', topology: 'test', commit: 'foundational', temporal: 'test', gate: [], substrate: [], invariants: [] },
            failure_mode: 'none',
            linked_patterns: [],
            commit: 'foundational',
            recency_weight: 0.01,
            last_updated_epoch: Date.now() - (365 * 24 * 60 * 60 * 1000),
            predicates: {},
            links: [],
            v2: true,
            schema_version: 2,
        };
        const result = checkForgetting(symbol);
        expect(result.prune).toBe(false);
        expect(result.archive).toBe(false);
    });

    it('should prune low-recency volatile symbols', () => {
        const symbol: SymbolDefV2 = {
            id: 'PRUNE',
            name: 'Prunable',
            kind: 'pattern',
            created_at: '2026-01-01',
            updated_at: '2026-01-01',
            triad: '💨',
            role: 'volatile',
            macro: 'INPUT -> OUTPUT',
            activation_conditions: [],
            symbol_domain: 'test',
            symbol_tag: '',
            facets: { function: 'test', topology: 'test', commit: 'volatile', temporal: 'test', gate: [], substrate: [], invariants: [] },
            failure_mode: 'none',
            linked_patterns: [],
            commit: 'volatile',
            recency_weight: 0.2,
            last_updated_epoch: Date.now(),
            predicates: {},
            links: [],
            v2: true,
            schema_version: 2,
        };
        const result = checkForgetting(symbol);
        expect(result.prune).toBe(true);
        expect(result.archive).toBe(false);
    });

    it('should archive very low-recency symbols older than 30 days', () => {
        const symbol: SymbolDefV2 = {
            id: 'ARCHIVE',
            name: 'Archivable',
            kind: 'pattern',
            created_at: '2026-01-01',
            updated_at: '2026-01-01',
            triad: '🗄️',
            role: 'old',
            macro: 'INPUT -> OUTPUT',
            activation_conditions: [],
            symbol_domain: 'test',
            symbol_tag: '',
            facets: { function: 'test', topology: 'test', commit: 'volatile', temporal: 'test', gate: [], substrate: [], invariants: [] },
            failure_mode: 'none',
            linked_patterns: [],
            commit: 'volatile',
            recency_weight: 0.005,
            last_updated_epoch: Date.now() - (35 * 24 * 60 * 60 * 1000),
            predicates: {},
            links: [],
            v2: true,
            schema_version: 2,
        };
        const result = checkForgetting(symbol);
        expect(result.prune).toBe(true);
        expect(result.archive).toBe(true);
    });
});
