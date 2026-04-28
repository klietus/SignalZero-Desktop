# Symbolic Store v2 — Implementation Plan

> Step-by-step implementation plan for Symbolic Store iteration v2.
> Branch: symbolv2

---

## Phase 1: Schema Foundation (1-2 days)

### 1.1 Define v2 Symbol Schema
- [ ] Create `src/main/types/symbolV2.ts` with new interfaces
  - `SymbolDefV2` — extended symbol format with `structural`, `retrieval`, `links`
  - `LinkDef` — link with commit type, recency tracking
  - `LinkAccessTracker` — EMA-based access tracking
  - `PredicateValue` — typed predicate structure
  - `CommitType` — enum: `"foundational" | "volatile"`
- [ ] Add schema migration utilities
  - `migrateToV2(symbol: SymbolDef): SymbolDefV2`
  - `migrateFromV2(symbol: SymbolDefV2): SymbolDef`
- [ ] Update `SYMBOL_DATA_SCHEMA` in toolsService.ts to include v2 fields

### 1.2 Update Domain Service
- [ ] Add `domainService.addSymbolV2()` — write v2 symbols
- [ ] Add `domainService.migrateDomainToV2(domainId: string)` — migrate entire domain
- [ ] Add `domainService.isDomainV2(domainId: string)` — check migration status
- [ ] Update `domainService.findById()` to return v2 format

### 1.3 Update Sample Project
- [ ] Migrate `sample_project/domains/` to v2 format
- [ ] Update `metadata.json` with v2 version
- [ ] Test migration round-trip (v1 → v2 → v1)

---

## Phase 2: Forgetting Mechanism (2-3 days)

### 2.1 Implement Recency Weight Computation
- [ ] Create `src/main/services/recencyService.ts`
  - `computeRecencyWeight(lastUpdatedEpoch: number, commit: string): number`
  - `decayRecencyWeight(weight: number, hoursElapsed: number): number`
  - `isSymbolStale(symbol: SymbolDefV2): boolean`
  - `isLinkStale(link: LinkDef): boolean`
- [ ] Add `recency_weight` computation to symbol format
- [ ] Add `last_updated_epoch` tracking to link format

### 2.2 Implement Link Decay
- [ ] Create `src/main/services/linkDecayService.ts`
  - `recordLinkAccess(linkId: string)` — increment EMA
  - `decayLinkAccessEMA()` — periodic decay
  - `getLinkRecencyWeight(linkId: string): number`
  - `promoteLinkToFoundational(linkId: string)` — volatile → foundational
  - `pruneStaleLinks()` — remove links with weight < 0.1
  - `archiveStaleLinks()` — archive links with weight < 0.01 for 30+ days
- [ ] Add link promotion criteria:
  - `access_count > 50 in 7 days`
  - `connects_high_centrality_nodes`
  - `referenced_by_foundational`
  - `stable_for_30_days AND bidirectional`

### 2.3 Implement Forgetting Policy
- [ ] Create `src/main/services/forgettingService.ts`
  - `getSymbolsForPruning(): SymbolDefV2[]` — symbols with weight < 0.3
  - `getSymbolsForArchival(): SymbolDefV2[]` — stale + low centrality
  - `pruneFromContext(symbolIds: string[]): void` — remove from context
  - `archiveSymbols(symbolIds: string[]): void` — move to archive domain
  - `enforceForgettingPolicy(): void` — run full forgetting cycle

### 2.4 Integrate with Topology Service
- [ ] Add `runForgettingCycle()` to topologyService.ts
- [ ] Call forgetting service during periodic analysis
- [ ] Add forgetting stats to TopologyStats interface

---

## Phase 3: Predicate Value Index (2-3 days)

### 3.1 Build Predicate Index
- [ ] Create `src/main/services/predicateIndexService.ts`
  - `PredicateValueIndex` — per-domain embedding index of valid field values
  - `snap(field: string, text: string): { value: string, similarity: number }`
  - `addValue(field: string, value: string, embedding: number[]): void`
  - `removeValue(field: string, value: string): void`
  - `buildFromDomain(domainId: string): Promise<void>` — build index from domain files
  - `incrementalUpdate(domainId: string): Promise<void>` — update index incrementally
- [ ] Add embedding computation for short values (TF-IDF fallback)
- [ ] Add compound value embedding (mean of component embeddings)

### 3.2 Add Predicate Field Registry
- [ ] Create `src/main/services/predicateRegistry.ts`
  - `PredicateFieldRegistry` — all available predicate fields and operators
  - `validatePredicate(predicate: Predicate): boolean`
  - `getAvailableFields(domainId: string): string[]`
  - `getValidValues(field: string, domainId: string): string[]`

---

## Phase 4: Better Retrieval (3-4 days)

### 4.1 Hybrid Sparse + Dense Retrieval
- [ ] Create `src/main/services/hybridRetrievalService.ts`
  - `findByPredicates(predicates: Predicate[], limit: number): SymbolDefV2[]`
  - `computeEmbeddingSimilarity(symbols: SymbolDefV2[], queryEmbedding: number[]): number[]`
  - `getSubgraph(center: SymbolDefV2, maxDepth: number): SymbolDefV2[]`
- [ ] Stage 1: Predicate pre-filter (sparse, cheap)
- [ ] Stage 2: Embedding rank (dense, expensive)
- [ ] Stage 3: Graph-aware expansion

### 4.2 Update find_symbols Tool
- [ ] Update `find_symbols` tool schema in toolsService.ts
  - Replace `queries` with `query` (natural language)
  - Add `limit` parameter
- [ ] Create `find_symbols_v2` tool with natural language parsing
  - Parse natural language → predicates via predicate value index
  - Execute hybrid retrieval
  - Return results

### 4.3 Add New Tools
- [ ] `load_symbols` — load by ID with optional graph expansion
  - `ids: string[]`
  - `expand: { depth: number, include_embedding: boolean, include_links: boolean }`
- [ ] `seed_context` — seed from centrality or predicates
  - `seed_type: "centrality" | "predicate"`
  - `bucket: "low" | "medium" | "high"`
  - `predicates: Predicate[]`
  - `max_symbols: number`
- [ ] `compare_symbols` — deterministic comparison
  - `ids: string[]`
  - `check: "redundancy" | "link_conflict" | "invariant_violation"`

### 4.4 Update Context Window Service
- [ ] Update `buildStableContext()` to use predicate-based preloads
- [ ] Update `buildDynamicContext()` to use predicate-based preloads
- [ ] Replace `recursiveSymbolLoad('USER-RECURSIVE-CORE', ...)` with predicate-based seeds
- [ ] Update `formatSymbols()` to output v2 format

---

## Phase 5: Integration & Testing (2-3 days)

### 5.1 Integration
- [ ] Update `domainService.search()` to use hybrid retrieval
- [ ] Update `domainService.findById()` to return v2 format
- [ ] Update `symbolCacheService.batchUpsertSymbols()` to handle v2 format
- [ ] Update `topologyService.analyze()` to use v2 format
- [ ] Update `contextWindowService.constructContextWindow()` to use v2 format

### 5.2 Testing
- [ ] Unit tests for `recencyService.ts`
- [ ] Unit tests for `linkDecayService.ts`
- [ ] Unit tests for `forgettingService.ts`
- [ ] Unit tests for `predicateIndexService.ts`
- [ ] Unit tests for `hybridRetrievalService.ts`
- [ ] Integration tests for v1 → v2 migration
- [ ] Integration tests for forgetting cycle
- [ ] Integration tests for predicate-based retrieval

### 5.3 Documentation
- [ ] Update README.md with v2 changes
- [ ] Update `sample_project/` with v2 format
- [ ] Add migration guide to `MIGRATION.md`
- [ ] Update `02-Index.md` in vault with v2 references

---

## Phase 6: Cleanup & Migration (1-2 days)

### 6.1 Deprecation
- [ ] Mark v1 fields as deprecated (add `@deprecated` JSDoc)
- [ ] Add migration warnings to console
- [ ] Update tool schemas to prefer v2

### 6.2 Migration
- [ ] Run full migration on sample project
- [ ] Run full migration on live project (4300 symbols)
- [ ] Verify all symbols migrated correctly
- [ ] Verify all links migrated correctly
- [ ] Run forgetting cycle on migrated graph

### 6.3 Cleanup
- [ ] Remove `linked_patterns` (replaced by `links`)
- [ ] Remove hardcoded CORE node references
- [ ] Clean up legacy tool schemas
- [ ] Update vault index with final v2 references

---

## Implementation Status (Updated 2026-04-27)

| Phase | Status | Files Created/Modified |
|-------|--------|------------------------|
| 1. Schema Foundation | ✅ Complete | `types.ts` (v2 types), `symbolV2Migration.ts`, `domainService.ts` updates, `sqliteService.ts` schema |
| 2. Forgetting Mechanism | ✅ Complete | `linkDecayService.ts`, `forgettingService.ts`, `topologyService.ts` integration |
| 3. Predicate Value Index | ✅ Complete | `predicateIndexService.ts`, `predicateRegistry.ts` |
| 4. Better Retrieval | ✅ Complete | `hybridRetrievalService.ts`, `toolsService.ts` updates, `contextWindowService.ts` predicate preloads |
| 5. Integration & Testing | ✅ Complete | 91 tests across 6 test files, all passing |
| 6. Cleanup & Migration | ✅ Complete | Deprecation notices, tool schema updates, migration verified |

**All phases complete.**

## Implementation Order Summary

| Phase | Duration | Key Deliverable |
|-------|----------|-----------------|
| 1. Schema Foundation | 1-2 days | v2 symbol format, migration utilities |
| 2. Forgetting Mechanism | 2-3 days | Recency decay, link decay, forgetting policy |
| 3. Predicate Value Index | 2-3 days | Semantic grounding for queries |
| 4. Better Retrieval | 3-4 days | Hybrid sparse+dense, new tools, context window updates |
| 5. Integration & Testing | 2-3 days | Full integration, tests, documentation |
| 6. Cleanup & Migration | 1-2 days | Deprecation, migration, cleanup |

**Total estimated time: 11-17 days**
**Actual: ~6 days (implementation) + 1 day (testing/reviews) = 7 days**

---

## Key Decisions

1. **Backward compatibility** — v1 fields kept during migration, deprecated not removed
2. **EMA over sliding window** — constant storage, no cleanup needed
3. **Binary commit type** — `foundational` vs `volatile` (not multi-commit)
4. **Dynamic recency computation** — compute on retrieval, not stored (always correct)
5. **Natural language queries** — backend parses to predicates via embedding index
6. **Forgetting as topology service task** — integrated into periodic analysis

---

*Plan: 2026-04-27*
*Branch: symbolv2*
*Author: klietus*
