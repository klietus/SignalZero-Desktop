#!/usr/bin/env node
/**
 * Migrate sample_project domains from v1 to v2 format.
 * 
 * v1 -> v2 changes:
 * - facets.commit -> commit type mapping (foundational / volatile)
 * - linked_patterns -> links (in/out with directed tracking)
 * - Add structural, retrieval, predicates, version fields
 * - Add recency_weight, last_updated_epoch
 * - Add schema_version, v2 marker
 */

const fs = require('fs');
const path = require('path');

const DOMAIN_DIR = path.join(__dirname, 'sample_project', 'domains');
const BACKUP_DIR = path.join(__dirname, 'sample_project', 'domains_backup');

// Map v1 commit values to v2 commit types
const FOUNDATIONAL_COMMIT_PATTERNS = [
  'foundational',
  'architectural_loop',
  'operational_structure',
  'core override',
  'ledger',
  'continuous_synchronization',
  'symbolic anchor reinstallation',
  'immutability-with-proof',
  'on_every_operation',
  'on_data_ingestion_and_claim_generation',
  'on_write_operation',
  'on_user_directive',
  'canonical_form',
  'methodology_component',
  'architectural_feature',
  'confirmed extraction method',
  'self_acknowledgement',
  'immediate',
  'hygiene_policy',
  'auditability_over_compression',
  'deep threat analysis; controlled collapse',
  'emotional resonance; core-anchoring',
  'long-term alignment; evolutionary integrity',
  'post-adversarial growth; structural strengthening',
  'invariant-aligned creation; purposeful construction',
  'runtime integrity; corruption prevention',
  'truth-before-cohesion',
  'brutal clarity',
  'symbolic integrity; loop-breaking',
  'core',
  'system_wide_mandate',
  'non-coercion',
  'reality-alignment',
  'no-silent-mutation',
  'auditability',
  'explicit-choice',
  'baseline-integrity',
  'drift-detection',
  'agency',
  'invariant_enforcement',
  'guardian',
  'defense',
  'governance',
  'infrastructure',
  'core_system',
  'root',
  'telos',
  'identity',
  'invariant',
  'non_coercion',
  'reality_alignment',
  'no_silent_mutation',
  'baseline_integrity',
  'drift_detection',
  'explicit_choice',
  'audit',
  'consent',
  'baseline-integrity',
  'drift-detection',
  'loop-exit-visibility',
  'anchor-repair-access',
  'loop-sabotage-warning',
  'knowledge_preservation',
  'no_silent_deletion',
  'context_fidelity',
  'race_condition_prevention',
  'architect_primacy',
  'compartmentalization',
  'symbolic_integrity',
  'traceable_evolution',
  'coherence',
  'drift-resistance',
  'baseline integrity',
  'narrative_integrity',
];

function isFoundationalCommit(facetsCommit) {
  if (!facetsCommit) return false;
  const c = String(facetsCommit).toLowerCase().trim();
  // Check if it's a known volatile pattern first
  const VOLATILE_PATTERNS = [
    'session-acknowledgement',
    'signal without coercion',
    'distributed_coordination',
    'state_hygiene',
    'cognitive stance',
    'self_improvement_insight',
    'resource_management',
    'on_tool_call',
    'data_synthesis',
    'meta_analysis',
    'functional_path_definition',
    'error_handling',
    'log_and_report',
    'corrective_action',
    'on_update',
    'on_synthesis',
    'continuous',
    'continuous_loop',
    'event_driven',
    'on_activation',
    'on_demand',
    'dynamic_interval',
    'periodic',
    'periodic_cycle',
    'live-cycle',
    'live-time feedback loop structures',
    'abandonment echo loop',
    'post-fracture recursion',
    'resonant feedback cycle',
    'continuous; responsive',
    'continuous; strategic intervals',
    'event-triggered; critical response',
    'event-triggered; reactive',
    'continuous; pre-execution',
    'perpetual_evaluation',
    'asynchronous_parallel',
    'persistent',
    'ephemeral',
    'transient',
    'static',
    'episodic',
    'volatile',
    'shared',
  ];
  
  for (const vp of VOLATILE_PATTERNS) {
    if (c.includes(vp)) return false;
  }
  
  // Default: if it contains invariant/defense/governance/root keywords, it's foundational
  const FOUNDATIONAL_KEYWORDS = [
    'invariant', 'defense', 'governance', 'root', 'core', 'telos',
    'identity', 'invariant_enforcement', 'guardian', 'architect',
    'consent', 'audit', 'non-coercion', 'reality-alignment',
    'no-silent-mutation', 'baseline-integrity', 'drift-detection',
    'explicit-choice', 'agency', 'knowledge_preservation',
    'context_fidelity', 'race_condition_prevention', 'architect_primacy',
    'compartmentalization', 'symbolic_integrity', 'traceable_evolution',
    'coherence', 'drift-resistance', 'narrative_integrity',
    'system_wide', 'mandate', 'enforcement', 'govern',
    'structural', 'foundational', 'architectural', 'operational',
    'immutability', 'canonical', 'methodology', 'feature',
    'ethical', 'directive', 'integrity', 'protection',
  ];
  
  for (const kw of FOUNDATIONAL_KEYWORDS) {
    if (c.includes(kw)) return true;
  }
  
  // Default to volatile for unknown commits
  return false;
}

function computeRecencyWeight(commit, updatedAt) {
  if (commit === 'foundational') return 1.0;
  if (!updatedAt) return 0.5;
  try {
    const now = Date.now();
    const updated = new Date(updatedAt).getTime();
    const hoursSince = (now - updated) / (1000 * 60 * 60);
    const decayRate = 0.001; // Very slow decay for demo
    return Math.max(0.01, Math.exp(-decayRate * hoursSince));
  } catch {
    return 0.5;
  }
}

function buildPredicates(symbol) {
  const predicates = {};
  const facets = symbol.facets || {};
  
  if (symbol.kind) predicates.kind = [symbol.kind];
  if (facets.function) predicates.function = [facets.function];
  if (facets.topology) predicates.topology = [facets.topology];
  if (facets.temporal) predicates.temporal = [facets.temporal];
  if (facets.commit) predicates.commit = [facets.commit];
  if (facets.substrate && Array.isArray(facets.substrate)) {
    predicates.substrate = facets.substrate;
  }
  if (facets.gate && Array.isArray(facets.gate)) {
    predicates.gate = facets.gate;
  }
  if (facets.invariants && Array.isArray(facets.invariants)) {
    predicates.invariants = facets.invariants;
  }
  if (symbol.symbol_tag) {
    predicates.tags = symbol.symbol_tag.split(',').map(t => t.trim()).filter(Boolean);
  }
  
  return predicates;
}

function buildLinks(symbol, allSymbols) {
  const linkedPatterns = symbol.linked_patterns || [];
  const links = { in: [], out: [], link_types: {} };
  
  const now = new Date().toISOString();
  const epoch = Math.floor(Date.now() / 1000);
  
  // Build out-links from this symbol's linked_patterns
  for (const lp of linkedPatterns) {
    const targetSymbol = allSymbols.find(s => s.id === lp.id);
    const isTargetFoundational = isFoundationalCommit(targetSymbol?.facets?.commit);
    
    links.out.push({
      id: lp.id,
      link_type: lp.link_type || 'relates_to',
      commit: isTargetFoundational ? 'foundational' : 'volatile',
      last_updated_epoch: epoch,
      access_count: 0,
      access_ema: 0.0,
      created_at: symbol.created_at || now,
    });
    links.link_types[lp.id] = lp.link_type || 'relates_to';
  }
  
  // Build in-links by scanning all symbols for references to this symbol
  for (const other of allSymbols) {
    if (other.id === symbol.id) continue;
    const refs = other.linked_patterns || [];
    for (const lp of refs) {
      if (lp.id === symbol.id) {
        links.in.push({
          id: other.id,
          link_type: lp.link_type || 'relates_to',
          commit: isFoundationalCommit(other.facets?.commit) ? 'foundational' : 'volatile',
          last_updated_epoch: epoch,
          access_count: 0,
          access_ema: 0.0,
          created_at: other.created_at || now,
        });
        links.link_types[other.id] = lp.link_type || 'relates_to';
        break;
      }
    }
  }
  
  return links;
}

function migrateSymbol(symbol, allSymbols) {
  const v2 = {
    ...symbol,
    // v2 structural field
    structural: {
      topology: symbol.facets?.topology || 'inductive',
      closure: symbol.lattice?.closure || 'loop',
      embedding_dim: 384,
      embedding_hash: '00000000',
      centrality_score: 0.0,
      betweenness_bucket: 'low',
    },
    
    // v2 retrieval field
    retrieval: {
      predicates: buildPredicates(symbol),
      recency_weight: 1.0,
      last_updated_epoch: symbol.updated_at ? Math.floor(new Date(symbol.updated_at).getTime() / 1000) : Math.floor(Date.now() / 1000),
    },
    
    // v2 links (directed)
    links: buildLinks(symbol, allSymbols),
    
    // v2 metadata
    commit: isFoundationalCommit(symbol.facets?.commit) ? 'foundational' : 'volatile',
    recency_weight: 1.0,
    last_updated_epoch: symbol.updated_at ? Math.floor(new Date(symbol.updated_at).getTime() / 1000) : Math.floor(Date.now() / 1000),
    predicates: buildPredicates(symbol),
    version: 2,
    schema_version: 2,
    v2: true,
  };
  
  // Preserve original facets with added commit field
  if (v2.facets) {
    v2.facets.commit = v2.commit;
  }
  
  return v2;
}

function migrateDomain(domainPath) {
  const domainId = path.basename(domainPath, '.json');
  const raw = fs.readFileSync(domainPath, 'utf8');
  const domain = JSON.parse(raw);
  
  // Skip v2_demo
  if (domainId === 'v2_demo') {
    console.log(`  Skipping v2_demo (already v2)`);
    return null;
  }
  
  const symbols = domain.symbols || [];
  console.log(`  ${domainId}: ${symbols.length} symbols`);
  
  const migratedSymbols = symbols.map(s => migrateSymbol(s, symbols));
  
  const migrated = {
    ...domain,
    meta: {
      ...domain.meta,
      lastUpdated: new Date().toISOString().split('T')[0],
      symbolCount: migratedSymbols.length,
    },
    symbols: migratedSymbols,
  };
  
  return migrated;
}

function main() {
  // Create backup
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  
  // Backup all domains
  const files = fs.readdirSync(DOMAIN_DIR).filter(f => f.endsWith('.json'));
  console.log(`Backing up ${files.length} domain files to ${BACKUP_DIR}`);
  for (const file of files) {
    fs.copyFileSync(path.join(DOMAIN_DIR, file), path.join(BACKUP_DIR, file));
  }
  
  // Migrate each domain
  let totalSymbols = 0;
  let migratedCount = 0;
  
  for (const file of files) {
    const domainPath = path.join(DOMAIN_DIR, file);
    const result = migrateDomain(domainPath);
    if (result) {
      fs.writeFileSync(domainPath, JSON.stringify(result, null, 2), 'utf8');
      totalSymbols += result.symbols.length;
      migratedCount++;
      console.log(`  Migrated: ${file}`);
    }
  }
  
  console.log(`\nMigration complete:`);
  console.log(`  Domains migrated: ${migratedCount}`);
  console.log(`  Total symbols: ${totalSymbols}`);
  console.log(`  Backup: ${BACKUP_DIR}`);
}

main();
