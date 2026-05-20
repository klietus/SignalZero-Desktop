const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const domainsDir = '/Users/klietus/workspace/signalzero/desktop/sample_project/domains';
const dbPath = '/Users/klietus/Library/Application Support/signal-zero-desktop/signalzero.db';

// Collect all links from domain files: { source_id: [target_ids] }
const domainFiles = fs.readdirSync(domainsDir).filter(f => f.endsWith('.json'));
const fileLinks = []; // [{file, sourceId, targetId, linkType}]

for (const file of domainFiles) {
  const filePath = path.join(domainsDir, file);
  try {
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!content.symbols || !Array.isArray(content.symbols)) continue;
    
    for (const symbol of content.symbols) {
      if (symbol.linked_patterns && Array.isArray(symbol.linked_patterns)) {
        for (const lp of symbol.linked_patterns) {
          fileLinks.push({
            file: file,
            sourceId: symbol.id,
            targetId: lp.id,
            linkType: lp.link_type || 'relates_to'
          });
        }
      }
    }
  } catch (err) {
    console.error(`Error reading ${file}:`, err.message);
  }
}

console.log(`Found ${fileLinks.length} links in domain files`);

// Connect to database
const db = new sqlite3.Database(dbPath);

let updatedCount = 0;
let missingSourceCount = 0;
let missingTargetCount = 0;
let alreadyFoundationalCount = 0;

db.serialize(() => {
  // First, check which links already exist and their state
  const checkStmt = db.prepare(`
    SELECT committed FROM symbol_links_v2 
    WHERE source_id = ? AND target_id = ? AND link_type = ?
  `);
  
  // Insert/update statement for foundational links
  const upsertStmt = db.prepare(`
    INSERT OR REPLACE INTO symbol_links_v2 
      (source_id, target_id, link_type, committed, access_count, access_ema, last_accessed, created_at)
    VALUES (?, ?, ?, 'foundational', 0, 0.0, datetime('now'), datetime('now'))
  `);

  for (const link of fileLinks) {
    // Check if both source and target symbols exist and are foundational
    const sourceCheck = db.get(
      "SELECT v2_commit FROM symbols WHERE id = ?", 
      [link.sourceId]
    );
    
    if (!sourceCheck) {
      missingSourceCount++;
      continue;
    }
    
    const targetCheck = db.get(
      "SELECT v2_commit FROM symbols WHERE id = ?", 
      [link.targetId]
    );
    
    if (!targetCheck) {
      missingTargetCount++;
      continue;
    }
    
    // Only process if both are foundational (from sample project files)
    if (sourceCheck.v2_commit !== 'foundational' || targetCheck.v2_commit !== 'foundational') {
      continue;
    }
    
    // Check existing state in v2 table
    const existing = checkStmt.get(link.sourceId, link.targetId, link.linkType);
    
    if (existing && existing.committed === 'foundational') {
      alreadyFoundationalCount++;
      continue;
    }
    
    // Upsert as foundational
    upsertStmt.run(link.sourceId, link.targetId, link.linkType);
    updatedCount++;
  }

  checkStmt.finalize();
  upsertStmt.finalize();

  // Summary
  console.log(`\n=== LINK UPDATE SUMMARY ===`);
  console.log(`Updated to foundational: ${updatedCount}`);
  console.log(`Already foundational: ${alreadyFoundationalCount}`);
  console.log(`Missing source symbol: ${missingSourceCount}`);
  console.log(`Missing target symbol: ${missingTargetCount}`);
  
  // Final distribution
  db.get(`SELECT committed, COUNT(*) as count FROM symbol_links_v2 GROUP BY committed`, [], (err, rows) => {
    if (err) throw err;
    
    console.log('\n=== FINAL LINK DISTRIBUTION ===');
    for (const row of rows) {
      console.log(`${row.committed}: ${row.count} links`);
    }
    
    db.close();
  });
});
