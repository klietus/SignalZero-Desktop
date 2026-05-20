import { describe, it, expect, beforeEach, vi, afterEach, afterAll } from 'vitest';
import { sqliteService } from '../services/sqliteService.js';
import { linkDecayService, setLastDecayTime } from '../services/linkDecayService.js';
import { eventBusService } from '../services/eventBusService.js';
import { KernelEventType } from '../types.js';

vi.mock('../services/eventBusService.js', () => ({
    eventBusService: {
        emitKernelEvent: vi.fn(),
    },
    KernelEventType: {
        TENTATIVE_LINK_CREATE: 'tentative:create',
    }
}));

afterAll(() => {
    // Prevent segfault by ensuring DB is closed after all tests
    try {
        const db = (sqliteService as any).db;
        if (db && typeof db.close === 'function') {
            db.close();
        }
    } catch (e) {
        // Ignore cleanup errors
    }
});

const resetDb = () => {
    sqliteService.__sqliteTestUtils.reset();
    sqliteService.run(`PRAGMA foreign_keys = OFF`);
    // Create the symbol_links_v2 table first
    sqliteService.run(`
        CREATE TABLE IF NOT EXISTS symbol_links_v2 (
            source_id TEXT NOT NULL,
            target_id TEXT NOT NULL,
            link_type TEXT DEFAULT 'relates_to',
            access_count INTEGER DEFAULT 0,
            access_ema REAL DEFAULT 0.0,
            last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP,
            committed TEXT DEFAULT 'volatile',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (source_id, target_id, link_type)
        );
    `);
    sqliteService.run(`DELETE FROM symbol_links_v2`);
};

const insertLink = (sourceId: string, targetId: string, options: { access_count?: number; access_ema?: number; committed?: string; created_at?: string } = {}) => {
    sqliteService.run(`
        INSERT OR REPLACE INTO symbol_links_v2 (source_id, target_id, link_type, access_count, access_ema, committed, created_at)
        VALUES (?, ?, 'relates_to', ?, ?, ?, ?)
    `, [sourceId, targetId, options.access_count || 0, options.access_ema || 0, options.committed || 'volatile', options.created_at || new Date().toISOString()]);
};

describe('linkDecayService — recordAccess', () => {
    beforeEach(resetDb);

    it('should increment access count and ema', () => {
        insertLink('S1', 'T1', { access_count: 0, access_ema: 0 });

        linkDecayService.recordAccess('S1', 'T1');

        const link = sqliteService.get(`SELECT * FROM symbol_links_v2 WHERE source_id = ? AND target_id = ?`, ['S1', 'T1']);
        expect(link.access_count).toBe(1);
        expect(link.access_ema).toBe(0.1);
    });

    it('should accumulate access correctly', () => {
        insertLink('S1', 'T1', { access_count: 10, access_ema: 0.5 });

        linkDecayService.recordAccess('S1', 'T1');
        linkDecayService.recordAccess('S1', 'T1');

        const link = sqliteService.get(`SELECT * FROM symbol_links_v2 WHERE source_id = ? AND target_id = ?`, ['S1', 'T1']);
        expect(link.access_count).toBe(12);
        expect(link.access_ema).toBeCloseTo(0.595, 2);
    });

    it('should not update if link does not exist', () => {
        linkDecayService.recordAccess('S1', 'NONEXISTENT');
        // Should not throw
    });
});

describe('linkDecayService — checkPromotion', () => {
    beforeEach(resetDb);

    it('should promote high-access links', () => {
        insertLink('S1', 'T1', { access_count: 60, access_ema: 0.5, committed: 'volatile' });
        // Set created_at to 5 days ago
        sqliteService.run(`UPDATE symbol_links_v2 SET created_at = ? WHERE source_id = ? AND target_id = ?`,
            [new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), 'S1', 'T1']);

        const promoted = linkDecayService.checkPromotion();
        expect(promoted).toContain('S1 -> T1');
    });

    it('should not promote low-access links', () => {
        insertLink('S1', 'T1', { access_count: 5, access_ema: 0.05, committed: 'volatile' });

        const promoted = linkDecayService.checkPromotion();
        expect(promoted).not.toContain('S1 -> T1');
    });

    it('should not promote already foundational links', () => {
        insertLink('S1', 'T1', { access_count: 100, access_ema: 0.9, committed: 'foundational' });

        const promoted = linkDecayService.checkPromotion();
        expect(promoted).not.toContain('S1 -> T1');
    });
});

describe('linkDecayService — pruneStale', () => {
    beforeEach(resetDb);

    it('should remove links with ema < 0.1 and age > 7 days', () => {
        const oldTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
        insertLink('S1', 'T1', { access_count: 0, access_ema: 0.05, committed: 'volatile' });
        sqliteService.run(`UPDATE symbol_links_v2 SET last_accessed = ? WHERE source_id = 'S1'`, [oldTime]);
        insertLink('S2', 'T2', { access_count: 50, access_ema: 0.5, committed: 'volatile' });

        const result = linkDecayService.pruneStale();

        expect(result.pruned).toBe(1);
        expect(result.links).toContain('S1 -> T1');

        const remaining = sqliteService.all(`SELECT * FROM symbol_links_v2`);
        expect(remaining).toHaveLength(1);
        expect(remaining[0].source_id).toBe('S2');
    });

    it('should not remove foundational links', () => {
        insertLink('S1', 'T1', { access_count: 0, access_ema: 0.05, committed: 'foundational' });

        const result = linkDecayService.pruneStale();
        expect(result.pruned).toBe(0);

        const remaining = sqliteService.all(`SELECT * FROM symbol_links_v2`);
        expect(remaining).toHaveLength(1);
    });
});

describe('linkDecayService — runDecayCycle', () => {
    beforeEach(resetDb);

    it('should run full decay cycle', () => {
        const veryOldTime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').replace('Z', '');
        insertLink('S1', 'T1', { access_count: 60, access_ema: 0.5, committed: 'volatile' });
        insertLink('S2', 'T2', { access_count: 0, access_ema: 0.05, committed: 'volatile' });
        // Set last_accessed to 8 days ago for S2 (prune threshold)
        const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').replace('Z', '');
        sqliteService.run(`UPDATE symbol_links_v2 SET last_accessed = ?, created_at = ? WHERE source_id = 'S2'`, [eightDaysAgo, veryOldTime]);

        // Force decay to run by setting lastDecayTime far in the past
        setLastDecayTime(Date.now() - 7200000); // 2 hours ago

        const result = linkDecayService.runDecayCycle();

        expect(result.decayed).toBeGreaterThanOrEqual(1);
        expect(result.promoted).toContain('S1 -> T1');
        expect(result.pruned).toBeGreaterThanOrEqual(0);
        expect(result.archived).toBeGreaterThanOrEqual(0);
    });
});

describe('linkDecayService — EMA decay accuracy', () => {
    beforeEach(resetDb);

    it('should decay by 10% per hour (factor 0.9)', () => {
        insertLink('S1', 'T1', { access_count: 10, access_ema: 1.0, committed: 'volatile' });
        
        // Set lastDecayTime to exactly 1 hour ago
        setLastDecayTime(Date.now() - 3600000);

        const updated = linkDecayService.decayEMAs();
        
        expect(updated).toBe(1);
        const link = sqliteService.get(`SELECT access_ema FROM symbol_links_v2 WHERE source_id = 'S1'`) as any;
        // After 1 hour: EMA = 1.0 * 0.9^1 = 0.9
        expect(link.access_ema).toBeCloseTo(0.9, 3);
    });

    it('should decay exponentially over multiple hours', () => {
        insertLink('S1', 'T1', { access_count: 10, access_ema: 1.0, committed: 'volatile' });
        
        // Set lastDecayTime to 3 hours ago
        setLastDecayTime(Date.now() - 3 * 3600000);

        linkDecayService.decayEMAs();
        
        const link = sqliteService.get(`SELECT access_ema FROM symbol_links_v2 WHERE source_id = 'S1'`) as any;
        // After 3 hours: EMA = 1.0 * 0.9^3 = 0.729
        expect(link.access_ema).toBeCloseTo(0.729, 3);
    });

    it('should not decay if less than 1 hour has passed', () => {
        insertLink('S1', 'T1', { access_count: 10, access_ema: 1.0, committed: 'volatile' });
        
        // Set lastDecayTime to 30 minutes ago
        setLastDecayTime(Date.now() - 1800000);

        const updated = linkDecayService.decayEMAs();
        
        expect(updated).toBe(0);
        const link = sqliteService.get(`SELECT access_ema FROM symbol_links_v2 WHERE source_id = 'S1'`) as any;
        expect(link.access_ema).toBe(1.0);
    });

    it('should handle long dormancy (24+ hours)', () => {
        insertLink('S1', 'T1', { access_count: 10, access_ema: 1.0, committed: 'volatile' });
        
        // Set lastDecayTime to 24 hours ago
        setLastDecayTime(Date.now() - 24 * 3600000);

        linkDecayService.decayEMAs();
        
        const link = sqliteService.get(`SELECT access_ema FROM symbol_links_v2 WHERE source_id = 'S1'`) as any;
        // After 24 hours: EMA = 1.0 * 0.9^24 ≈ 0.08
        expect(link.access_ema).toBeCloseTo(0.08, 2);
    });

    it('should skip foundational links during decay', () => {
        insertLink('S1', 'T1', { access_count: 10, access_ema: 1.0, committed: 'foundational' });
        
        setLastDecayTime(Date.now() - 3600000);

        linkDecayService.decayEMAs();
        
        const link = sqliteService.get(`SELECT access_ema FROM symbol_links_v2 WHERE source_id = 'S1'`) as any;
        expect(link.access_ema).toBe(1.0);
    });
});

describe('linkDecayService — promotion thresholds', () => {
    beforeEach(resetDb);

    it('should promote via fast-track: ≥50 accesses in 7 days + EMA > 0.3', () => {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        insertLink('S1', 'T1', { access_count: 50, access_ema: 0.35, committed: 'volatile' });
        sqliteService.run(`UPDATE symbol_links_v2 SET created_at = ? WHERE source_id = 'S1'`, [sevenDaysAgo]);

        const promoted = linkDecayService.checkPromotion();
        
        expect(promoted).toContain('S1 -> T1');
    });

    it('should not promote if access count is below threshold', () => {
        insertLink('S1', 'T1', { access_count: 49, access_ema: 0.5, committed: 'volatile' });

        const promoted = linkDecayService.checkPromotion();
        
        expect(promoted).not.toContain('S1 -> T1');
    });

    it('should not promote if EMA is below threshold', () => {
        insertLink('S1', 'T1', { access_count: 60, access_ema: 0.29, committed: 'volatile' });

        const promoted = linkDecayService.checkPromotion();
        
        expect(promoted).not.toContain('S1 -> T1');
    });

    it('should promote via stability: ≥30 days old + EMA > 0.001', () => {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        insertLink('S1', 'T1', { access_count: 5, access_ema: 0.002, committed: 'volatile' });
        sqliteService.run(`UPDATE symbol_links_v2 SET created_at = ? WHERE source_id = 'S1'`, [thirtyDaysAgo]);

        const promoted = linkDecayService.checkPromotion();
        
        expect(promoted).toContain('S1 -> T1');
    });

    it('should not promote if age is below 30 days for stability path', () => {
        const twentyNineDaysAgo = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString();
        insertLink('S1', 'T1', { access_count: 5, access_ema: 0.5, committed: 'volatile' });
        sqliteService.run(`UPDATE symbol_links_v2 SET created_at = ? WHERE source_id = 'S1'`, [twentyNineDaysAgo]);

        const promoted = linkDecayService.checkPromotion();
        
        expect(promoted).not.toContain('S1 -> T1');
    });
});

describe('linkDecayService — integration: access patterns over time', () => {
    beforeEach(resetDb);

    it('should promote a link through sustained access pattern', () => {
        // Create a new volatile link
        insertLink('S1', 'T1', { access_count: 0, access_ema: 0.0, committed: 'volatile' });
        
        // Simulate rapid accesses over time
        setLastDecayTime(Date.now() - 2 * 3600000); // 2 hours ago
        
        // First burst of 30 accesses
        for (let i = 0; i < 30; i++) {
            linkDecayService.recordAccess('S1', 'T1');
        }

        let link = sqliteService.get(`SELECT * FROM symbol_links_v2 WHERE source_id = 'S1'`) as any;
        expect(link.access_count).toBe(30);
        
        // Decay for 1 hour
        setLastDecayTime(Date.now() - 3600000);
        linkDecayService.decayEMAs();
        
        // Second burst of 25 accesses (total ≥50)
        for (let i = 0; i < 25; i++) {
            linkDecayService.recordAccess('S1', 'T1');
        }

        link = sqliteService.get(`SELECT * FROM symbol_links_v2 WHERE source_id = 'S1'`) as any;
        expect(link.access_count).toBe(55);
        
        // Check promotion - should now meet fast-track criteria
        const promoted = linkDecayService.checkPromotion();
        expect(promoted).toContain('S1 -> T1');
    });

    it('should decay and not promote if access is sporadic', () => {
        insertLink('S1', 'T1', { access_count: 0, access_ema: 0.0, committed: 'volatile' });
        
        // Single access
        linkDecayService.recordAccess('S1', 'T1');
        
        // Decay for 24 hours (EMA drops significantly)
        setLastDecayTime(Date.now() - 24 * 3600000);
        linkDecayService.decayEMAs();
        
        let link = sqliteService.get(`SELECT access_ema FROM symbol_links_v2 WHERE source_id = 'S1'`) as any;
        expect(link.access_ema).toBeLessThan(0.1);
        
        // Not enough accesses for fast-track, not old enough for stability
        const promoted = linkDecayService.checkPromotion();
        expect(promoted).not.toContain('S1 -> T1');
    });
});
