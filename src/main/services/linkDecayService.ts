import { sqliteService } from './sqliteService.js';
import { loggerService, LogCategory } from './loggerService.js';
import { eventBusService } from './eventBusService.js';
import { KernelEventType } from '../types.js';
import { checkLinkPromotion, recordLinkAccess, isLinkStale } from './symbolV2Migration.js';

const DECAY_INTERVAL_MS = 3600000; // 1 hour
const DECAY_FACTOR = 0.9; // 10% decay per interval

let lastDecayTime = Date.now();

// Export for testing access
export { lastDecayTime };
export const setLastDecayTime = (t: number) => { lastDecayTime = t; };

export const linkDecayService = {
  DECAY_INTERVAL_MS,
  DECAY_FACTOR,

  recordAccess(sourceId: string, targetId: string): void {
    const link = sqliteService.get(
      `SELECT * FROM symbol_links_v2 WHERE source_id = ? AND target_id = ?`,
      [sourceId, targetId]
    ) as any;

    if (!link) return;

    const updated = recordLinkAccess(link);
    sqliteService.run(`
      UPDATE symbol_links_v2 SET access_count = ?, access_ema = ?, last_accessed = ?
      WHERE source_id = ? AND target_id = ?
    `, [
      (updated.access_count ?? link.access_count ?? 0),
      updated.access_ema ?? link.access_ema ?? 0,
      updated.last_accessed ?? new Date().toISOString(),
      sourceId,
      targetId,
    ]);

    eventBusService.emitKernelEvent(KernelEventType.TENTATIVE_LINK_CREATE, {
      sourceId,
      targetId,
      count: updated.access_count ?? link.access_count ?? 0,
      age: link.created_at ? Math.floor((Date.now() - new Date(link.created_at).getTime()) / (1000 * 60 * 60)) : 0,
    } as const);
  },

  decayEMAs(): number {
    const now = Date.now();
    const hoursSinceDecay = (now - lastDecayTime) / (1000 * 60 * 60);

    if (hoursSinceDecay < 1) return 0;

    const links = sqliteService.all(`
      SELECT source_id, target_id, access_ema FROM symbol_links_v2
      WHERE committed = 'volatile'
    `) as any[];

    let updated = 0;
    for (const link of links) {
      const newEma = (link.access_ema ?? 0) * Math.pow(DECAY_FACTOR, hoursSinceDecay);
      sqliteService.run(`
        UPDATE symbol_links_v2 SET access_ema = ? WHERE source_id = ? AND target_id = ?
      `, [newEma, link.source_id, link.target_id]);
      updated++;
    }

    lastDecayTime = now;

    if (updated > 0) {
      loggerService.catDebug(LogCategory.TOPOLOGY, `Link EMA decayed for ${updated} links`);
    }

    return updated;
  },

  checkPromotion(): string[] {
    const links = sqliteService.all(`
      SELECT * FROM symbol_links_v2 WHERE committed = 'volatile'
    `) as any[];

    const promoted: string[] = [];

    for (const link of links) {
      if (checkLinkPromotion(link)) {
        sqliteService.run(`
          UPDATE symbol_links_v2 SET committed = 'foundational'
          WHERE source_id = ? AND target_id = ?
        `, [link.source_id, link.target_id]);
        promoted.push(`${link.source_id} -> ${link.target_id}`);
      }
    }

    if (promoted.length > 0) {
      loggerService.catInfo(LogCategory.TOPOLOGY, `Promoted ${promoted.length} links to foundational`);
    }

    return promoted;
  },

  pruneStale(): { pruned: number; links: string[] } {
    const staleLinks = sqliteService.all(`
      SELECT source_id, target_id FROM symbol_links_v2
      WHERE committed = 'volatile' AND access_ema < 0.1
        AND julianday('now') - julianday(last_accessed) > 7
    `) as any[];

    const pruned: string[] = [];
    for (const link of staleLinks) {
      sqliteService.run(`
        DELETE FROM symbol_links_v2 WHERE source_id = ? AND target_id = ?
      `, [link.source_id, link.target_id]);
      pruned.push(`${link.source_id} -> ${link.target_id}`);
    }

    if (pruned.length > 0) {
      loggerService.catInfo(LogCategory.TOPOLOGY, `Pruned ${pruned.length} stale links`);
    }

    return { pruned: pruned.length, links: pruned };
  },

  archiveStale(days: number = 30): { archived: number } {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const result = sqliteService.run(`
      UPDATE symbol_links_v2 SET committed = 'archived'
      WHERE committed = 'volatile' AND access_ema < 0.01 AND created_at < ?
    `, [cutoff]);

    return { archived: (result as any).changes || 0 };
  },

  runDecayCycle(): { decayed: number; promoted: string[]; pruned: number; archived: number } {
    const decayed = this.decayEMAs();
    const promoted = this.checkPromotion();
    const { pruned } = this.pruneStale();
    const { archived } = this.archiveStale();

    return { decayed, promoted, pruned, archived };
  }
};
