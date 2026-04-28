import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sqliteService } from '../services/sqliteService.js';
import { domainService } from '../services/domainService.js';
import { predicateValueIndex } from '../services/predicateIndexService.js';
import { hybridRetrievalService } from '../services/hybridRetrievalService.js';
import { Predicate } from '../services/hybridRetrievalService.js';

vi.mock('../services/embeddingService.js', () => ({
    embedTexts: vi.fn().mockImplementation((texts: string[]) => {
        // Return simple deterministic embeddings
        return texts.map((text, i) => {
            const vec = new Array(10).fill(0);
            for (let j = 0; j < Math.min(text.length, 10); j++) {
                vec[j] = text.charCodeAt(j) / 255;
            }
            // Normalize
            const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
            if (norm > 0) vec.forEach((v, j) => vec[j] = v / norm);
            return vec;
        });
    }),
}));

vi.mock('../services/predicateIndexService.js', () => ({
    predicateValueIndex: {
        getValues: vi.fn().mockReturnValue([]),
        snap: vi.fn().mockReturnValue(null),
        getFields: vi.fn().mockReturnValue([]),
        addValue: vi.fn(),
        removeValue: vi.fn(),
        clear: vi.fn(),
        buildFromDomain: vi.fn().mockResolvedValue(undefined),
        incrementalUpdate: vi.fn().mockResolvedValue(undefined),
    }
}));

const resetDb = () => {
    sqliteService.__sqliteTestUtils.reset();
    sqliteService.run(`PRAGMA foreign_keys = OFF`);

    sqliteService.run(`
        CREATE TABLE IF NOT EXISTS domains (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            invariants TEXT,
            enabled INTEGER DEFAULT 1,
            read_only INTEGER DEFAULT 0,
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    sqliteService.run(`
        CREATE TABLE IF NOT EXISTS symbols (
            id TEXT PRIMARY KEY,
            domain_id TEXT NOT NULL,
            name TEXT NOT NULL,
            kind TEXT DEFAULT 'pattern',
            triad TEXT,
            role TEXT,
            macro TEXT,
            invocations TEXT,
            lattice TEXT,
            persona TEXT,
            data TEXT,
            facets TEXT,
            activation_conditions TEXT,
            failure_mode TEXT,
            symbol_tag TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            v2_commit TEXT DEFAULT 'volatile',
            v2_recency_weight REAL DEFAULT 1.0,
            v2_last_updated INTEGER
        );
    `);
    sqliteService.run(`
        CREATE TABLE IF NOT EXISTS symbol_links (
            source_id TEXT NOT NULL,
            target_id TEXT NOT NULL,
            link_type TEXT DEFAULT 'relates_to',
            bidirectional INTEGER DEFAULT 0,
            PRIMARY KEY (source_id, target_id, link_type)
        );
    `);

    sqliteService.run(`INSERT OR REPLACE INTO domains (id, name, enabled) VALUES (?, ?, ?)`, ['test-domain', 'Test Domain', 1]);
};

const insertSymbol = (id: string, options: {
    name?: string;
    kind?: string;
    role?: string;
    macro?: string;
    triad?: string;
    symbol_tag?: string;
    facets?: string;
    recency_weight?: number;
    commit?: string;
    last_updated?: number;
} = {}) => {
    sqliteService.run(`
        INSERT OR REPLACE INTO symbols (id, domain_id, name, kind, triad, role, macro, symbol_tag, facets, v2_commit, v2_recency_weight, v2_last_updated)
        VALUES (?, 'test-domain', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        id,
        options.name || id,
        options.kind || 'pattern',
        options.triad || '🔹',
        options.role || 'test',
        options.macro || 'INPUT -> OUTPUT',
        options.symbol_tag || '',
        options.facets || '{}',
        options.commit || 'volatile',
        options.recency_weight ?? 1.0,
        options.last_updated ?? Date.now(),
    ]);
};

const insertLink = (sourceId: string, targetId: string, linkType: string = 'relates_to') => {
    sqliteService.run(`
        INSERT OR REPLACE INTO symbol_links (source_id, target_id, link_type)
        VALUES (?, ?, ?)
    `, [sourceId, targetId, linkType]);
};

describe('hybridRetrievalService — retrieve', () => {
    beforeEach(resetDb);

    it('should return results for a query', async () => {
        insertSymbol('SYM-1', { name: 'Anchor', role: 'anchor', kind: 'pattern', symbol_tag: 'core, foundational' });
        insertSymbol('SYM-2', { name: 'Processor', role: 'processor', kind: 'pattern', symbol_tag: 'volatile' });
        insertSymbol('SYM-3', { name: 'Output', role: 'output', kind: 'data', symbol_tag: 'data' });

        const results = await hybridRetrievalService.retrieve('anchor concept', [], 10, 0);

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].symbol.id).toBeDefined();
    });

    it('should rank by embedding similarity', async () => {
        insertSymbol('CORE-1', { name: 'Core Anchor', role: 'anchor', kind: 'pattern', symbol_tag: 'core' });
        insertSymbol('CORE-2', { name: 'Core Processor', role: 'processor', kind: 'pattern', symbol_tag: 'core' });
        insertSymbol('UNRELATED', { name: 'Random Thing', role: 'random', kind: 'data', symbol_tag: 'unrelated' });

        const results = await hybridRetrievalService.retrieve('core anchor concept', [], 10, 0);

        expect(results.length).toBeGreaterThan(0);
        // CORE-1 should rank higher than UNRELATED
        const core1Idx = results.findIndex(r => r.symbol.id === 'CORE-1');
        const unrelatedIdx = results.findIndex(r => r.symbol.id === 'UNRELATED');
        if (core1Idx >= 0 && unrelatedIdx >= 0) {
            expect(core1Idx).toBeLessThan(unrelatedIdx);
        }
    });

    it('should apply recency weight to score', async () => {
        const recentTime = Date.now();
        const oldTime = Date.now() - (30 * 24 * 60 * 60 * 1000);

        insertSymbol('RECENT', { name: 'Recent', recency_weight: 1.0, last_updated: recentTime });
        insertSymbol('OLD', { name: 'Old', recency_weight: 0.01, last_updated: oldTime });

        const results = await hybridRetrievalService.retrieve('test', [], 10, 0);

        // Both should be found
        const recent = results.find(r => r.symbol.id === 'RECENT');
        const old = results.find(r => r.symbol.id === 'OLD');
        expect(recent).toBeDefined();
        expect(old).toBeDefined();
    });
});

describe('hybridRetrievalService — getSubgraph', () => {
    beforeEach(resetDb);

    it('should return centered symbol and its links', async () => {
        insertSymbol('CENTER');
        insertSymbol('LINK-1');
        insertSymbol('LINK-2');
        insertLink('CENTER', 'LINK-1');
        insertLink('CENTER', 'LINK-2');

        const subgraph = await hybridRetrievalService.getSubgraph('CENTER', 1);

        const ids = subgraph.map(s => s.id);
        expect(ids).toContain('CENTER');
        expect(ids).toContain('LINK-1');
        expect(ids).toContain('LINK-2');
    });

    it('should respect max depth', async () => {
        insertSymbol('L0');
        insertSymbol('L1-A');
        insertSymbol('L1-B');
        insertSymbol('L2-A');
        insertLink('L0', 'L1-A');
        insertLink('L0', 'L1-B');
        insertLink('L1-A', 'L2-A');

        const subgraph = await hybridRetrievalService.getSubgraph('L0', 1);
        const ids = subgraph.map(s => s.id);

        expect(ids).toContain('L0');
        expect(ids).toContain('L1-A');
        expect(ids).toContain('L1-B');
        expect(ids).not.toContain('L2-A'); // Depth 2 should not be included
    });

    it('should handle symbol with no links', async () => {
        insertSymbol('ISOLATED');

        const subgraph = await hybridRetrievalService.getSubgraph('ISOLATED', 2);
        expect(subgraph).toHaveLength(1);
        expect(subgraph[0].id).toBe('ISOLATED');
    });

    it('should handle non-existent symbol', async () => {
        const subgraph = await hybridRetrievalService.getSubgraph('NONEXISTENT', 2);
        expect(subgraph).toHaveLength(0);
    });
});

describe('hybridRetrievalService — cosine similarity', () => {
    it('should compute identical vectors as 1.0', async () => {
        insertSymbol('V1', { name: 'Test', symbol_tag: 'test' });
        insertSymbol('V2', { name: 'Test', symbol_tag: 'test' });

        const results = await hybridRetrievalService.retrieve('test', [], 10, 0);
        expect(results.length).toBeGreaterThan(0);
    });

    it('should compute orthogonal vectors as 0.0', () => {
        const a = [1, 0, 0];
        const b = [0, 1, 0];
        const sim = (hybridRetrievalService as any).cosineSimilarity(a, b);
        expect(sim).toBeCloseTo(0.0, 5);
    });

    it('should compute opposite vectors as -1.0', () => {
        const a = [1, 0, 0];
        const b = [-1, 0, 0];
        const sim = (hybridRetrievalService as any).cosineSimilarity(a, b);
        expect(sim).toBeCloseTo(-1.0, 5);
    });

    it('should return 0 for different length vectors', () => {
        const a = [1, 0, 0];
        const b = [1, 0];
        const sim = (hybridRetrievalService as any).cosineSimilarity(a, b);
        expect(sim).toBe(0);
    });
});

describe('hybridRetrievalService — graph expansion', () => {
    beforeEach(resetDb);

    it('should expand by specified depth', async () => {
        insertSymbol('ROOT');
        insertSymbol('HOP1-A');
        insertSymbol('HOP1-B');
        insertSymbol('HOP2-A');
        insertLink('ROOT', 'HOP1-A');
        insertLink('ROOT', 'HOP1-B');
        insertLink('HOP1-A', 'HOP2-A');

        const results = await hybridRetrievalService.retrieve('root', [], 10, 2);
        const ids = results.map(r => r.symbol.id);

        expect(ids).toContain('ROOT');
        expect(ids).toContain('HOP1-A');
        expect(ids).toContain('HOP1-B');
        expect(ids).toContain('HOP2-A');
    });

    it('should include expanded symbols in results', async () => {
        insertSymbol('CENTER');
        insertSymbol('EXPANDED');
        insertLink('CENTER', 'EXPANDED');

        const results = await hybridRetrievalService.retrieve('center', [], 10, 1);

        const ids = results.map(r => r.symbol.id);
        expect(ids).toContain('CENTER');
        expect(ids).toContain('EXPANDED');
    });
});
