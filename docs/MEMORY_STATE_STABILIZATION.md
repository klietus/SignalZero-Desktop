# Memory State Stabilization: EMA Decay & Hebbian Learning

SignalZero implements biologically-inspired memory stabilization routines to maintain a dynamic, self-organizing knowledge graph. These mechanisms ensure that **active connections strengthen** while **stale associations fade**, mimicking synaptic plasticity in neural systems.

## Core Concepts

### Volatile vs Foundational vs Archived Links

Links in the symbolic graph exist in three states:

| State | Lifetime | Behavior |
| :--- | :--- | :--- |
| **Volatile** | Temporary | Subject to decay, promotion, or pruning based on access patterns |
| **Foundational** | Permanent | Stable links that have proven their value through sustained use |
| **Archived** | Dormant | Old, low-activity links preserved but excluded from active reasoning |

### Hebbian Learning Principle

> *"Neurons that fire together, wire together."*

In SignalZero, when two symbols are accessed in proximity (within the same context window), their connecting link strengthens. This is tracked via:
- **Access Count**: Raw number of times the link has been activated
- **Access EMA**: Exponential Moving Average that weights recent activity more heavily

### EMA Decay Mechanism

Links naturally decay over time to prevent memory bloat and prioritize recent relevance.

**Decay Parameters:**
```typescript
DECAY_INTERVAL_MS = 3600000; // 1 hour
DECAY_FACTOR = 0.9;          // 10% decay per interval
```

The EMA formula:
```
new_ema = old_ema × (decay_factor ^ hours_elapsed)
```

This creates **time-weighted memory**: a link accessed heavily last week but not today will have lower activation than one accessed frequently in the past hour.

## The Stabilization Pipeline

### 1. Recording Accesses (`linkDecayService.recordAccess`)

Every time a symbol link is used during inference:
```typescript
recordAccess(sourceId: string, targetId: string): void
```

**Actions:**
- Increments `access_count` for the link
- Updates `access_ema` with immediate reinforcement (no decay)
- Sets `last_accessed` timestamp
- Emits `kernel_event:tentative_link_create` for real-time monitoring

### 2. Automatic Decay (`linkDecayService.decayEMAs`)

Runs on-demand (not currently scheduled automatically):
```typescript
decayEMAs(): number // Returns count of links updated
```

**Process:**
1. Calculates hours elapsed since last decay cycle
2. If < 1 hour, skips (no change needed)
3. For all **volatile** links: applies exponential decay formula
4. Updates `lastDecayTime` to current timestamp

**Scope:** Only affects volatile links; foundational and archived links are immutable by decay.

### 3. Link Promotion (`linkDecayService.checkPromotion`)

Elevates high-value volatile links to **foundational** status:
```typescript
checkPromotion(): string[] // Returns array of promoted link IDs
```

**Fast-Track Criteria (Immediate Promotion):**
- `access_count >= 50` within the last 7 days
- AND `access_ema > 0.3`

**Stability Criteria:**
- Link age >= 30 days
- AND `access_ema > 0.001`

Once promoted, links become **immune to decay and pruning**, representing core knowledge structures.

### 4. Stale Link Pruning (`linkDecayService.pruneStale`)

Removes dead connections that consume resources:
```typescript
pruneStale(): { pruned: number; links: string[] }
```

**Pruning Conditions:**
- `committed = 'volatile'`
- `access_ema < 0.1` (very low activation)
- `last_accessed > 7 days ago` (no recent use)

**Effect:** Emits `kernel_event:tentative_link_delete` and permanently removes the link from SQLite.

### 5. Long-Term Archival (`linkDecayService.archiveStale`)

Moves old, low-value links to dormant state:
```typescript
archiveStale(days: number = 30): { archived: number }
```

**Archival Conditions:**
- `committed = 'volatile'`
- `access_ema < 0.01` (negligible activation)
- `created_at > 30 days old`

Unlike pruning, archival **preserves the link** for potential future recovery but excludes it from active reasoning.

### 6. Full Decay Cycle (`linkDecayService.runDecayCycle`)

Executes all stabilization routines in sequence:
```typescript
runDecayCycle(): { decayed: number; promoted: string[]; pruned: number; archived: number }
```

**Order of Operations:**
1. `decayEMAs()` - Reduce activation levels
2. `checkPromotion()` - Promote stable links
3. `pruneStale()` - Remove dead links
4. `archiveStale()` - Archive old, weak links

## Current Implementation Status

### Active Components
- ✅ Link access recording (via `recordLinkAccess` in symbolV2Migration.ts)
- ✅ EMA decay calculations
- ✅ Promotion logic (fast-track and stability criteria)
- ✅ Pruning and archival routines
- ✅ Event bus integration for real-time monitoring

### Not Yet Scheduled
⚠️ **Automatic decay cycles are NOT currently running on a schedule.** The `runDecayCycle()` method exists but must be invoked manually or via external scheduler.

**Recommended Scheduling:**
```typescript
// Example: Run full cycle every 6 hours
setInterval(() => {
  linkDecayService.runDecayCycle();
}, 6 * 60 * 60 * 1000); // 6 hours
```

### Manual Invocation (for testing/debugging)
The Hebbian Dashboard provides a **Force Decay Cycle** button that triggers `runDecayCycle()` on demand, useful for:
- Testing promotion/decay behavior
- Debugging link state transitions
- Immediate cleanup during development

## Database Schema

Links are stored in SQLite table `symbol_links_v2`:

```sql
CREATE TABLE symbol_links_v2 (
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  type TEXT NOT NULL,           -- Link taxonomy (relates_to, depends_on, etc.)
  committed TEXT DEFAULT 'volatile', -- volatile | foundational | archived
  access_count INTEGER DEFAULT 0,
  access_ema REAL DEFAULT 0.0,
  last_accessed TEXT,           -- ISO timestamp
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_id, target_id)
);
```

## Monitoring & Visualization

### Hebbian Dashboard
The `/hebbian` view in the desktop app provides real-time monitoring:

**Tabs:**
1. **Overview**: Distribution of links by state (volatile/foundational/archived)
2. **Nearing Promotion**: Links approaching fast-track or stability criteria
3. **At Risk of Decay**: Volatile links with low EMA that may be pruned soon
4. **Recent Activity**: Timeline of link accesses and state transitions

**Actions:**
- Force decay cycle (manual trigger for testing)
- View individual link metrics (count, EMA, age, last accessed)

## Design Principles

### 1. **Temporal Weighting**
Recent activity matters more than historical frequency. A link accessed 10 times today is stronger than one accessed 50 times last month.

### 2. **Progressive Stabilization**
Links evolve through stages: volatile → (tested) → foundational. This prevents premature commitment to weak associations.

### 3. **Resource Efficiency**
Pruning and archival prevent graph bloat, ensuring the active knowledge base remains lean and performant.

### 4. **Reversibility**
Archival is not deletion. Dormant links can be recovered if patterns re-emerge, preserving long-term memory without polluting active reasoning.

## Future Enhancements

- [ ] Implement automatic scheduling of `runDecayCycle()` (e.g., every 6 hours)
- [ ] Add decay cycle metrics to system health dashboard
- [ ] Support manual link state transitions (promote/archive/prune via UI)
- [ ] Configure per-domain decay rates (some domains may need faster/slower stabilization)
- [ ] Export/import link states for backup and migration

## Related Documentation

- [Symbolic System](SYMBOLIC_SYSTEM.md) - Link taxonomy and graph structure
- [Graph Hygiene](HYGIENE_AND_TOPOLOGY.md) - Topology analysis and maintenance
- [Architecture](ARCHITECTURE.md) - Service architecture and event bus
