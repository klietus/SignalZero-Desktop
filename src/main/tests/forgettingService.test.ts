import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sqliteService } from '../services/sqliteService.js';
import { domainService } from '../services/domainService.js';
import { lancedbService } from '../services/lancedbService.js';
import { forgettingService } from '../services/forgettingService.js';
import { eventBusService } from '../services/eventBusService.js';
import { KernelEventType } from '../types.js';

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
    KernelEventType: {
        SYMBOL_DELETED: 'symbol:deleted',
        SYMBOL_UPSERTED: 'symbol:upserted',
    }
}));

vi.mock('../services/domainService.js', () => ({
    domainService: {
        getAllSymbols: vi.fn(),
        getSymbols: vi.fn(),
        listDomains: vi.fn(),
    }
}));

const resetDb = () => {
    sqliteService.__sqliteTestUtils.reset();
    sqliteService.run(`PRAGMA foreign_keys = OFF`);
    // Create required tables
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
            v2_last_updated INTEGER,
            FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
        );
    `);

    // Create a test domain
    sqliteService.run(`INSERT OR REPLACE INTO domains (id, name, enabled) VALUES (?, ?, ?)`, ['test-domain', 'Test Domain', 1]);
};

const insertSymbol = (id: string, options: { recency_weight?: number; commit?: string; last_updated?: number; domain_id?: string } = {}) => {
    const domainId = options.domain_id || 'test-domain';
    const commit = options.commit || 'volatile';
    const weight = options.recency_weight ?? 1.0;
    const lastUpdated = options.last_updated ?? Date.now();

    sqliteService.run(`
        INSERT OR REPLACE INTO symbols (id, domain_id, name, kind, triad, role, macro, facets, activation_conditions, failure_mode, symbol_tag, v2_commit, v2_recency_weight, v2_last_updated)
        VALUES (?, ?, ?, 'pattern', '🔹', 'test', 'INPUT -> OUTPUT', '{}', '[]', 'none', '', ?, ?, ?)
    `, [id, domainId, 'test', commit, weight, lastUpdated]);
};

describe('forgettingService — getSymbolsForPruning', () => {
    beforeEach(resetDb);

    it('should return symbols with recency_weight below threshold', () => {
        insertSymbol('PRUNE-1', { recency_weight: 0.2 });
        insertSymbol('PRUNE-2', { recency_weight: 0.15 });
        insertSymbol('KEEP', { recency_weight: 0.5 });

        const candidates = forgettingService.getSymbolsForPruning();
        const ids = candidates.map(s => s.id);

        expect(ids).toContain('PRUNE-1');
        expect(ids).toContain('PRUNE-2');
        expect(ids).not.toContain('KEEP');
    });

    it('should not return foundational symbols', () => {
        insertSymbol('FOUND', { recency_weight: 0.1, commit: 'foundational' });

        const candidates = forgettingService.getSymbolsForPruning();
        const ids = candidates.map(s => s.id);
        expect(ids).not.toContain('FOUND');
    });
});

describe('forgettingService — getSymbolsForArchival', () => {
    beforeEach(resetDb);

    it('should return very low recency symbols older than 30 days', () => {
        const oldTime = Date.now() - (35 * 24 * 60 * 60 * 1000);
        insertSymbol('ARCHIVE-1', { recency_weight: 0.005, last_updated: oldTime });
        insertSymbol('RECENT-OLD', { recency_weight: 0.005, last_updated: Date.now() });
        insertSymbol('RECENT', { recency_weight: 0.5, last_updated: oldTime });

        const candidates = forgettingService.getSymbolsForArchival();
        const ids = candidates.map(s => s.id);

        expect(ids).toContain('ARCHIVE-1');
        expect(ids).not.toContain('RECENT-OLD');
        expect(ids).not.toContain('RECENT');
    });
});

describe('forgettingService — pruneFromContext', () => {
    beforeEach(resetDb);

    it('should delete symbols from the database', () => {
        insertSymbol('PRUNE-1');
        insertSymbol('PRUNE-2');
        insertSymbol('KEEP');

        forgettingService.pruneFromContext(['PRUNE-1', 'PRUNE-2']);

        const remaining = sqliteService.all(`SELECT id FROM symbols WHERE domain_id = 'test-domain'`);
        const ids = remaining.map((r: any) => r.id);
        expect(ids).toContain('KEEP');
        expect(ids).not.toContain('PRUNE-1');
        expect(ids).not.toContain('PRUNE-2');
    });

    it('should handle empty array', () => {
        insertSymbol('KEEP');
        forgettingService.pruneFromContext([]);
        const remaining = sqliteService.all(`SELECT id FROM symbols WHERE domain_id = 'test-domain'`);
        expect(remaining).toHaveLength(1);
    });
});

describe('forgettingService — archiveSymbols', () => {
    beforeEach(resetDb);

    it('should set commit to archived', () => {
        insertSymbol('ARCHIVE-1', { commit: 'volatile' });
        insertSymbol('ARCHIVE-2', { commit: 'volatile' });

        forgettingService.archiveSymbols(['ARCHIVE-1']);

        const row = sqliteService.get(`SELECT v2_commit FROM symbols WHERE id = ?`, ['ARCHIVE-1']);
        expect(row.v2_commit).toBe('archived');
    });
});

describe('forgettingService — decayRecencyWeights', () => {
    beforeEach(resetDb);

    it('should decay volatile symbol weights', () => {
        const recentTime = Date.now() - (2 * 60 * 60 * 1000); // 2 hours ago
        insertSymbol('DECAY-1', { last_updated: recentTime, recency_weight: 1.0 });

        forgettingService.decayRecencyWeights();

        const row = sqliteService.get(`SELECT v2_recency_weight FROM symbols WHERE id = ?`, ['DECAY-1']);
        expect(row.v2_recency_weight).toBeLessThan(1.0);
        expect(row.v2_recency_weight).toBeGreaterThan(0.9);
    });

    it('should not decay foundational symbols', () => {
        const recentTime = Date.now() - (2 * 60 * 60 * 1000);
        insertSymbol('FOUND', { last_updated: recentTime, recency_weight: 1.0, commit: 'foundational' });

        forgettingService.decayRecencyWeights();

        const row = sqliteService.get(`SELECT v2_recency_weight FROM symbols WHERE id = ?`, ['FOUND']);
        expect(row.v2_recency_weight).toBe(1.0);
    });
});

describe('forgettingService — runForgettingCycle', () => {
    beforeEach(resetDb);

    it('should execute full forgetting pipeline', () => {
        const oldTime = Date.now() - (35 * 24 * 60 * 60 * 1000);
        const pruneTime = Date.now() - (10 * 24 * 60 * 60 * 1000); // ~10 days ago = recency < 0.3

        // Symbol to prune (low recency due to age)
        insertSymbol('PRUNE-ME', { last_updated: pruneTime });

        // Symbol to archive (very low recency, old)
        insertSymbol('ARCHIVE-ME', { last_updated: oldTime });

        // Symbol to keep (recent)
        insertSymbol('KEEP-ME', { last_updated: Date.now() });

        const result = forgettingService.runForgettingCycle();

        expect(result.decayed).toBeGreaterThan(0);
        expect(result.pruneCandidates).toBeGreaterThanOrEqual(1);
        expect(result.pruned).toBeGreaterThanOrEqual(1);
        expect(result.archiveCandidates).toBeGreaterThanOrEqual(1);
        expect(result.archived).toBeGreaterThanOrEqual(1);

        // Verify KEEP-ME is still there
        const keep = sqliteService.get(`SELECT id FROM symbols WHERE id = 'KEEP-ME'`);
        expect(keep).toBeDefined();
    });

    it('should handle empty database', () => {
        // Delete all symbols
        sqliteService.run(`DELETE FROM symbols`);

        const result = forgettingService.runForgettingCycle();
        expect(result.decayed).toBe(0);
        expect(result.pruned).toBe(0);
        expect(result.archived).toBe(0);
    });
});

describe('forgettingService — setPolicy', () => {
    it('should update the forgetting policy', () => {
        const originalThreshold = forgettingService.policy.prune_threshold;
        forgettingService.setPolicy({ prune_threshold: 0.5 });
        expect(forgettingService.policy.prune_threshold).toBe(0.5);
        forgettingService.setPolicy({ prune_threshold: originalThreshold });
    });
});
