#!/usr/bin/env node

/**
 * Migrate sample_project domains to v2 format.
 * Run: node scripts/migrate-sample-to-v2.js
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SAMPLE_DIR = join(process.cwd(), 'sample_project');
const DOMAINS_DIR = join(SAMPLE_DIR, 'domains');

function migrateToV2(symbol) {
  const links = (symbol.linked_patterns || []).map(lp => ({
    id: lp.id,
    link_type: lp.link_type || 'relates_to',
    access_count: 0,
    access_ema: 0.0,
    last_accessed: symbol.updated_at || new Date().toISOString(),
    committed: 'volatile',
    created_at: symbol.created_at || new Date().toISOString(),
  }));

  const predicates = {};
  if (symbol.facets?.function) predicates.function = [symbol.facets.function];
  if (symbol.facets?.topology) predicates.topology = [symbol.facets.topology];
  if (symbol.facets?.temporal) predicates.temporal = [symbol.facets.temporal];
  if (symbol.symbol_tag) predicates.tags = symbol.symbol_tag.split(',').map(t => t.trim()).filter(Boolean);
  if (symbol.kind) predicates.kind = [symbol.kind];

  return {
    ...symbol,
    commit: symbol.facets?.commit === 'foundational' ? 'foundational' : 'volatile',
    recency_weight: 1.0,
    last_updated_epoch: symbol.updated_at ? new Date(symbol.updated_at).getTime() : Date.now(),
    predicates,
    links,
    v2: true,
    schema_version: 2,
  };
}

function migrateDomainFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const data = JSON.parse(content);

  if (!data.symbols || !Array.isArray(data.symbols)) {
    console.log(`⏭️  Skipping ${filePath} (no symbols)`);
    return 0;
  }

  let migrated = 0;
  const v2Symbols = data.symbols.map(symbol => {
    const v2 = migrateToV2(symbol);
    migrated++;
    return v2;
  });

  const output = {
    meta: {
      ...data.meta,
      lastUpdated: new Date().toISOString().split('T')[0] + ' ' + new Date().toISOString().split('T')[1].split('.')[0],
      schemaVersion: 2,
      migratedAt: new Date().toISOString(),
    },
    symbols: v2Symbols,
  };

  writeFileSync(filePath, JSON.stringify(output, null, 2), 'utf-8');
  return migrated;
}

function migrateAllDomains() {
  const files = readdirSync(DOMAINS_DIR).filter(f => f.endsWith('.json'));
  let totalMigrated = 0;

  console.log(`🔄 Migrating ${files.length} domains to v2...`);

  for (const file of files) {
    const filePath = join(DOMAINS_DIR, file);
    const migrated = migrateDomainFile(filePath);
    console.log(`✅ ${file}: ${migrated} symbols migrated`);
    totalMigrated += migrated;
  }

  console.log(`\n🎉 Migration complete: ${totalMigrated} symbols migrated across ${files.length} domains`);
}

migrateAllDomains();
