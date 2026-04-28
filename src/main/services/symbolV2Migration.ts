import { SymbolDef, SymbolDefV2, CommitType, SymbolLinkV2, LINK_PROMOTION_DEFAULTS, FORGETTING_DEFAULTS } from '../types';

export function migrateToV2(symbol: SymbolDef, existingLinks?: SymbolLinkV2[]): SymbolDefV2 {
  // If symbol is already V2, return as-is
  if ((symbol as any).v2 === true) return symbol as SymbolDefV2;

  // Use existing V2 links if provided (from DB), otherwise create from linked_patterns
  const links: SymbolLinkV2[] = existingLinks || (symbol.linked_patterns || []).map(lp => ({
    id: lp.id,
    link_type: lp.link_type || 'relates_to',
    access_count: 0,
    access_ema: 0.0,
    last_accessed: symbol.updated_at || new Date().toISOString(),
    committed: 'volatile' as CommitType,
    created_at: symbol.created_at || new Date().toISOString(),
  }));

  const predicates: Record<string, string[]> = {};
  if (symbol.facets?.function) {
    predicates.function = [symbol.facets.function];
  }
  if (symbol.facets?.topology) {
    predicates.topology = [symbol.facets.topology];
  }
  if (symbol.facets?.temporal) {
    predicates.temporal = [symbol.facets.temporal];
  }
  if (symbol.symbol_tag) {
    predicates.tags = symbol.symbol_tag.split(',').map(t => t.trim()).filter(Boolean);
  }
  if (symbol.kind) {
    predicates.kind = [symbol.kind];
  }

  const v2: SymbolDefV2 = {
    id: symbol.id,
    name: symbol.name,
    kind: symbol.kind,
    triad: symbol.triad,
    role: symbol.role,
    macro: symbol.macro,
    lattice: symbol.lattice,
    persona: symbol.persona,
    data: symbol.data,
    activation_conditions: symbol.activation_conditions,
    symbol_domain: symbol.symbol_domain,
    symbol_tag: symbol.symbol_tag,
    facets: symbol.facets,
    failure_mode: symbol.failure_mode,
    linked_patterns: symbol.linked_patterns,
    created_at: symbol.created_at,
    updated_at: symbol.updated_at,
    commit: symbol.facets?.commit === 'foundational' ? 'foundational' : 'volatile',
    recency_weight: 1.0,
    last_updated_epoch: symbol.updated_at ? new Date(symbol.updated_at).getTime() : Date.now(),
    predicates,
    embedding: undefined,
    links,
    v2: true,
    schema_version: 2,
  };

  return v2;
}

export function migrateFromV2(v2: SymbolDefV2): SymbolDef {
  const linked_patterns = (v2.links || []).map(l => ({
    id: l.id,
    link_type: l.link_type,
    bidirectional: false,
  }));

  const facets = { ...(v2.facets || {}) };
  if (v2.commit && !facets.commit) {
    facets.commit = v2.commit;
  }

  return {
    id: v2.id,
    name: v2.name,
    kind: v2.kind,
    triad: v2.triad,
    role: v2.role,
    macro: v2.macro,
    lattice: v2.lattice,
    persona: v2.persona,
    data: v2.data,
    activation_conditions: v2.activation_conditions,
    symbol_domain: v2.symbol_domain,
    symbol_tag: v2.symbol_tag,
    failure_mode: v2.failure_mode,
    created_at: v2.created_at,
    updated_at: v2.updated_at,
    linked_patterns,
    facets,
  };
}

export function computeRecencyWeight(epoch: number, commit: CommitType): number {
  if (commit === 'foundational') return 1.0;
  if (!epoch || isNaN(epoch)) return 0;
  const hours = (Date.now() - epoch) / (1000 * 60 * 60);
  return Math.max(0, Math.exp(-hours / 168));
}

export function decayRecencyWeight(weight: number, hoursElapsed: number): number {
  return Math.max(0, weight * Math.exp(-hoursElapsed / 168));
}

export function isSymbolStale(symbol: SymbolDefV2): boolean {
  if (symbol.commit === 'foundational') return false;
  if (symbol.recency_weight < 0.1) return true;
  if (!symbol.last_updated_epoch || isNaN(symbol.last_updated_epoch)) return true;
  const hours = (Date.now() - symbol.last_updated_epoch) / (1000 * 60 * 60);
  return hours > 720;
}

export function isLinkStale(link: SymbolLinkV2): boolean {
  if (link.committed === 'foundational') return false;
  if (!link.last_accessed || isNaN(new Date(link.last_accessed).getTime())) return true;
  const hours = (Date.now() - new Date(link.last_accessed).getTime()) / (1000 * 60 * 60);
  return link.access_ema < 0.1 && hours > 168;
}

export function recordLinkAccess(link: Partial<SymbolLinkV2>): Partial<SymbolLinkV2> {
  const now = Date.now();
  const ema = link.access_ema || 0;
  const count = link.access_count || 0;
  const lastAccessed = link.last_accessed ? new Date(link.last_accessed).getTime() : now;
  const hoursElapsed = (now - lastAccessed) / (1000 * 60 * 60);
  const timeDecay = Math.exp(-hoursElapsed / 168);
  const newEma = (ema * timeDecay * 0.9) + 0.1;
  return {
    access_count: count + 1,
    access_ema: newEma,
    last_accessed: new Date(now).toISOString(),
  };
}

export function checkLinkPromotion(link: SymbolLinkV2): boolean {
  const criteria = LINK_PROMOTION_DEFAULTS;
  if (!link.created_at || isNaN(new Date(link.created_at).getTime())) return false;
  const hours = (Date.now() - new Date(link.created_at).getTime()) / (1000 * 60 * 60);
  const days = hours / 24;

  // Fast-track: high access within time window
  if (link.access_count >= criteria.access_count_threshold &&
      hours <= criteria.time_window_hours &&
      link.access_ema > criteria.centrality_threshold) {
    return true;
  }

  // Stability: moderate access sustained over long period
  if (days >= criteria.stability_days && link.access_ema > 0.001) {
    return true;
  }

  return false;
}

export function checkForgetting(symbol: SymbolDefV2, policy: typeof FORGETTING_DEFAULTS = FORGETTING_DEFAULTS): { prune: boolean; archive: boolean } {
  if (policy.exempt_foundational && symbol.commit === 'foundational') {
    return { prune: false, archive: false };
  }

  const shouldPrune = symbol.recency_weight < policy.prune_threshold;
  const shouldArchive = symbol.recency_weight < policy.archive_threshold;
  const lastUpdated = symbol.last_updated_epoch || Date.now();
  const days = (Date.now() - lastUpdated) / (1000 * 60 * 60 * 24);
  const archiveAgeOk = days >= policy.archive_min_days;

  return {
    prune: shouldPrune,
    archive: shouldArchive && archiveAgeOk,
  };
}
