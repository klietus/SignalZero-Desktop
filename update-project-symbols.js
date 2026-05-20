const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const domainsDir = '/Users/klietus/workspace/signalzero/desktop/sample_project/domains';
const dbPath = '/Users/klietus/Library/Application Support/signal-zero-desktop/signalzero.db';

// Collect all symbol IDs from domain files
const domainFiles = fs.readdirSync(domainsDir).filter(f => f.endsWith('.json'));
const symbolIdsByDomain = {};

for (const file of domainFiles) {
  const filePath = path.join(domainsDir, file);
  try {
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!content.symbols || !Array.isArray(content.symbols)) continue;
    
    symbolIdsByDomain[file.replace('.json', '')] = content.symbols.map(s => s.id);
  } catch (err) {
    console.error(`Error reading ${file}:`, err.message);
  }
}

// Connect to database and update symbols
const db = new sqlite3.Database(dbPath);

let totalUpdated = 0;

db.serialize(() => {
  const stmt = db.prepare(`
    UPDATE symbols 
    SET v2_commit = 'foundational', 
        v2_recency_weight = 1.0,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND v2_commit != 'foundational'
  `);

  for (const [domainId, symbolIds] of Object.entries(symbolIdsByDomain)) {
    let domainUpdated = 0;
    
    for (const symbolId of symbolIds) {
      stmt.run(symbolId, function(err) {
        if (!err && this.changes > 0) {
          domainUpdated++;
        }
      });
    }
    
    if (domainUpdated > 0) {
      console.log(`✓ ${domainId}: ${domainUpdated}/${symbolIds.length} symbols updated to foundational`);
      totalUpdated += domainUpdated;
    } else {
      console.log(`- ${domainId}: no changes needed`);
    }
  }

  stmt.finalize();

  // Final summary
  db.get(`SELECT v2_commit, COUNT(*) as count FROM symbols GROUP BY v2_commit`, [], (err, rows) => {
    if (err) throw err;
    
    console.log('\n=== FINAL DISTRIBUTION ===');
    for (const row of rows) {
      console.log(`${row.v2_commit}: ${row.count} symbols`);
    }
    
    db.close();
  });
});
