import { sqliteService } from './sqliteService.js';
import { loggerService, LogCategory } from './loggerService.js';
import { eventBusService } from './eventBusService.js';
import { KernelEventType, SymbolDefV2, FORGETTING_DEFAULTS } from '../types.js';
import { computeRecencyWeight, checkForgetting } from './symbolV2Migration.js';

export const forgettingService = {
  policy: { ...FORGETTING_DEFAULTS },

  setPolicy(policy: Partial<typeof FORGETTING_DEFAULTS>): void {
    if (policy.prune_threshold !== undefined && (policy.prune_threshold < 0 || policy.prune_threshold > 1)) {
      throw new Error('prune_threshold must be between 0 and 1');
    }
    if (policy.archive_threshold !== undefined && (policy.archive_threshold < 0 || policy.archive_threshold > 1)) {
      throw new Error('archive_threshold must be between 0 and 1');
    }
    if (policy.archive_min_days !== undefined && policy.archive_min_days < 1) {
      throw new Error('archive_min_days must be >= 1');
    }
    this.policy = { ...this.policy, ...policy };
  },

  getSymbolsForPruning(): SymbolDefV2[] {
    const rows = sqliteService.all(`
      SELECT * FROM symbols
      WHERE v2_recency_weight < ?
        AND v2_commit != 'foundational'
        AND domain_id IN (SELECT id FROM domains WHERE enabled = 1)
    `, [this.policy.prune_threshold]) as any[];

    return rows.map(row => this.rowToV2(row));
  },

  getSymbolsForArchival(): SymbolDefV2[] {
    const cutoff = Date.now() - this.policy.archive_min_days * 24 * 60 * 60 * 1000;

    const rows = sqliteService.all(`
      SELECT * FROM symbols
      WHERE v2_recency_weight < ?
        AND (v2_last_updated IS NULL OR v2_last_updated < ?)
        AND v2_commit != 'foundational'
        AND domain_id IN (SELECT id FROM domains WHERE enabled = 1)
    `, [this.policy.archive_threshold, cutoff]) as any[];

    return rows.map(row => this.rowToV2(row));
  },

  pruneFromContext(symbolIds: string[]): void {
    if (symbolIds.length === 0) return;

    const placeholders = symbolIds.map(() => '?').join(',');
    sqliteService.run(`
      DELETE FROM symbols WHERE id IN (${placeholders})
    `, symbolIds);

    for (const id of symbolIds) {
      eventBusService.emitKernelEvent(KernelEventType.SYMBOL_DELETED, {
        symbolId: id,
        isEviction: true,
      } as const);
    }

    loggerService.catInfo(LogCategory.TOPOLOGY, `Pruned ${symbolIds.length} symbols from context`);
  },

  archiveSymbols(symbolIds: string[]): void {
    if (symbolIds.length === 0) return;

    const placeholders = symbolIds.map(() => '?').join(',');
    sqliteService.run(`
      UPDATE symbols SET v2_commit = 'archived' WHERE id IN (${placeholders})
    `, symbolIds);

    loggerService.catInfo(LogCategory.TOPOLOGY, `Archived ${symbolIds.length} symbols`);
  },

  decayRecencyWeights(): number {
    const rows = sqliteService.all(`
      SELECT id, v2_last_updated, v2_commit FROM symbols WHERE v2_commit = 'volatile'
    `) as any[];

    if (rows.length === 0) {
      loggerService.catDebug(LogCategory.TOPOLOGY, `No volatile symbols to decay`);
      return 0;
    }

    const now = Date.now();
    let updated = 0;

    sqliteService.transaction(() => {
      for (const row of rows) {
        const weight = computeRecencyWeight(row.v2_last_updated, row.v2_commit as 'volatile');
        sqliteService.run(`
          UPDATE symbols SET v2_recency_weight = ? WHERE id = ?
        `, [weight, row.id]);
        updated++;
      }
    })();

    if (updated > 0) {
      loggerService.catDebug(LogCategory.TOPOLOGY, `Decayed recency weights for ${updated} symbols`);
    }

    return updated;
  },

  runForgettingCycle(): {
    decayed: number;
    pruneCandidates: number;
    pruned: number;
    archiveCandidates: number;
    archived: number;
  } {
    // Step 1: Decay recency weights
    const decayed = this.decayRecencyWeights();

    // Step 2: Get prune candidates
    const pruneCandidates = this.getSymbolsForPruning();

    // Step 3: Get archive candidates
    const archiveCandidates = this.getSymbolsForArchival();

    // Step 4: Prune (exclude archive candidates)
    const archiveIdSet = new Set(archiveCandidates.map(a => a.id));
    const pruneIds = pruneCandidates
      .filter(s => !archiveIdSet.has(s.id))
      .map(s => s.id);
    this.pruneFromContext(pruneIds);

    // Step 5: Archive
    const archiveIds = archiveCandidates.map(s => s.id);
    this.archiveSymbols(archiveIds);

    loggerService.catInfo(LogCategory.TOPOLOGY, `Forgetting cycle complete: decayed=${decayed}, prune=${pruneIds.length}, archive=${archiveIds.length}`);

    return {
      decayed,
      pruneCandidates: pruneCandidates.length,
      pruned: pruneIds.length,
      archiveCandidates: archiveCandidates.length,
      archived: archiveIds.length,
    };
  },

  rowToV2(row: any): any {
    const v2Commit = row.v2_commit || 'volatile';
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      triad: row.triad,
      role: row.role,
      macro: row.macro,
      lattice: row.lattice ? JSON.parse(row.lattice) : undefined,
      persona: row.persona ? JSON.parse(row.persona) : undefined,
      data: row.data ? JSON.parse(row.data) : undefined,
      facets: row.facets ? JSON.parse(row.facets) : {},
      activation_conditions: row.activation_conditions ? JSON.parse(row.activation_conditions) : [],
      symbol_domain: row.domain_id,
      symbol_tag: row.symbol_tag || '',
      failure_mode: row.failure_mode,
      created_at: row.created_at,
      updated_at: row.updated_at,
      commit: v2Commit as 'foundational' | 'volatile' | 'archived',
      recency_weight: row.v2_recency_weight || 1.0,
      last_updated_epoch: row.v2_last_updated || (row.updated_at ? new Date(row.updated_at).getTime() : Date.now()),
      predicates: {},
      links: [],
      v2: true,
      schema_version: 2,
    };
  }
};
