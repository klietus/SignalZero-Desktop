# SignalZero Technical Debt & Roadmap

## 1. Complete Deprecation and Removal of V1 Symbols and Link Structures
- [ ] Remove `symbol_links` table (V1) - migrate all data to `symbol_links_v2`
- [ ] Remove `symbols.symbol_tag` field (replaced by facets/structured metadata)
- [ ] Remove `symbols.kind`, `triad`, `role`, `macro` fields if not used in V2
- [ ] Update all services to use only V2 schema (`symbol_links_v2`)
- [ ] Remove migration utilities from `symbolV2Migration.ts` once complete
- [ ] Update tests to reflect V2-only schema
- [ ] Document breaking changes for external integrations

## 2. Promotion of Symbols (Foundational ↔ Volatile)
### Current State
- Links can be promoted based on access patterns (EMA thresholds)
- **Missing**: Symbol-level promotion/demotion logic

### TODO
- [ ] Define symbol promotion criteria (access count, link stability, cross-domain usage)
- [ ] Implement `promoteSymbol()` / `demoteSymbol()` methods in service layer
- [ ] Add automatic symbol promotion during decay cycle
- [ ] Track symbol lifetime metrics (age, access patterns, link churn)
- [ ] Handle cascading effects when symbol type changes (links may need re-evaluation)

## 3. Hebbian Learning Debugging and Activation Hooks
### Current State
- Link access tracking exists (`recordAccess()`) but unclear if called during normal operation
- No visible activation/deactivation hooks for symbols

### TODO
- [ ] Audit all call sites of `linkDecayService.recordAccess()` - verify it's being called
- [ ] Add instrumentation/logging to track when links are accessed
- [ ] Implement symbol activation hooks (on-access, on-search, on-context)
- [ ] Implement symbol deactivation/demotion logic based on inactivity
- [ ] Create debug dashboard showing:
  - Real-time link access events
  - EMA values over time
  - Activation/deactivation triggers
- [ ] Add Hebbian learning visualization (heat map of link strength changes)

## 4. Tests for EMA Link Decay
### Current State
- Basic tests exist in `forgettingService.test.ts` but incomplete coverage

### TODO
- [ ] Unit tests for EMA decay factor (0.9/hour) accuracy
- [ ] Test time-based decay with mocked timestamps
- [ ] Test promotion thresholds:
  - Fast-track: ≥50 accesses in 7 days + EMA > 0.3
  - Stability: ≥30 days old + EMA > 0.001
- [ ] Integration test: simulate access patterns over time, verify promotion
- [ ] Edge cases: rapid access bursts, long dormancy, mixed foundational/volatile links
- [ ] Performance test: decay cycle with 10k+ links

## 5. Refactor Topology Service to Combine Run Strategies and Optimize
### Current State
- Multiple strategies (positional, semantic, triadic) run separately
- Link decay now runs after every topology analysis (may be redundant)

### TODO
- [ ] Audit all hygiene strategies - identify overlapping work
- [ ] Consolidate database transactions where possible
- [ ] Batch operations for better performance
- [ ] Consider running link decay less frequently than full topology analysis
- [ ] Add caching for expensive computations (embeddings, similarity scores)
- [ ] Profile current execution time per strategy
- [ ] Implement incremental updates vs. full re-analysis

## 6. Measurement and Tuning of Decay and Promotion
### Current State
- Hardcoded thresholds in `LINK_PROMOTION_DEFAULTS`
- No metrics collection or feedback loop

### TODO
- [ ] Add metrics collection:
  - Links promoted/demoted per cycle
  - Average time to promotion
  - Link churn rate (created/removed)
  - Symbol lifetime distribution
- [ ] Create analytics dashboard for decay/promotion stats
- [ ] A/B testing framework for threshold tuning
- [ ] Adaptive thresholds based on system behavior
- [ ] Alerting for anomalies (e.g., no promotions in X cycles, mass demotions)

## 7. UI for Decay and Promotion Stats and Tuning Controls
### Current State
- Basic "Run Now" button added to Settings > Graph Hygiene
- No visibility into current state or history

### TODO
- [ ] Create dedicated "Link Decay" settings section with:
  - Current stats (total links, foundational vs. volatile, pending promotions)
  - Last run timestamp and results summary
  - Manual trigger button (already exists)
- [ ] Add tuning controls:
  - EMA decay factor slider (default: 0.9/hour)
  - Fast-track threshold inputs (access count, time window, EMA min)
  - Stability threshold inputs (age days, EMA min)
- [ ] Create "Link Health" visualization page:
  - Histogram of link ages
  - Access frequency distribution
  - Promotion/demotion history timeline
- [ ] Add export/import for decay configuration

## Priority Order
1. **Critical**: #4 Tests for EMA Link Decay (need confidence before tuning)
2. **High**: #3 Hebbian Learning Debugging (verify it's working at all)
3. **Medium**: #6 Measurement and Tuning (data-driven decisions)
4. **Medium**: #7 UI for Stats/Controls (operational visibility)
5. **Low**: #1 V1 Deprecation (can wait until stable)
6. **Low**: #2 Symbol Promotion (depends on link promotion stability)
7. **Low**: #5 Topology Refactor (optimization, not correctness)

## Notes
- Link decay integration complete (runs with topology analysis every 15 min)
- Manual trigger available in Settings > Graph Hygiene
- Next step: verify `recordAccess()` is being called during normal operation
