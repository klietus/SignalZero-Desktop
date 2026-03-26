import { SymbolDef, SymbolLink, VectorSearchResult } from '../types.js';
import { lancedbService } from './lancedbService.js';
import { sqliteService } from './sqliteService.js';
import { loggerService, LogCategory } from './loggerService.js';
import { eventBusService, KernelEventType } from './eventBusService.js';
import { USER_DOMAIN_TEMPLATE, STATE_DOMAIN_TEMPLATE } from '../symbolic_system/domain_templates.js';

const mapRowToDomain = (row: any): any => ({
    id: row.id,
    name: row.name,
    description: row.description,
    invariants: row.invariants ? JSON.parse(row.invariants) : [],
    enabled: !!row.enabled,
    readOnly: !!row.read_only,
    lastUpdated: row.last_updated,
    symbolCount: row.symbolCount || 0
});

const mapRowToSymbol = (row: any, links: SymbolLink[] = []): SymbolDef => ({
    id: row.id,
    domain_id: row.domain_id,
    symbol_domain: row.domain_id,
    symbol_tag: row.symbol_tag || '',
    name: row.name,
    kind: row.kind as any,
    triad: row.triad,
    role: row.role,
    macro: row.macro,
    facets: row.facets ? JSON.parse(row.facets) : {},
    activation_conditions: row.activation_conditions ? JSON.parse(row.activation_conditions) : [],
    failure_mode: row.failure_mode,
    created_at: row.created_at,
    updated_at: row.updated_at,
    linked_patterns: links
});

export const domainService = {
  // --- Domain Management ---

  async init(domainId: string, name: string): Promise<any> {
    let existing = await this.get(domainId);

    let template: any = {};
    if (domainId === 'user') template = USER_DOMAIN_TEMPLATE;
    else if (domainId === 'state') template = STATE_DOMAIN_TEMPLATE;

    if (!existing) {
        await this.createDomain(domainId, {
            name: template.name || name,
            description: template.description || "",
            invariants: template.invariants || [],
            readOnly: template.readOnly || false
        });
    }

    if (template.symbols && template.symbols.length > 0) {
        loggerService.catInfo(LogCategory.DOMAIN, `Syncing ${template.symbols.length} core symbols for domain ${domainId}`);
        await this.bulkUpsertSymbols(template.symbols, domainId);
    }

    return this.get(domainId);
  },

  async listDomains(): Promise<string[]> {
    const rows = sqliteService.all(`SELECT id FROM domains`) as any[];
    return rows.map(r => r.id);
  },

  async getMetadata(): Promise<any[]> {
    const rows = sqliteService.all(`
        SELECT d.*, (SELECT COUNT(*) FROM symbols s WHERE s.domain_id = d.id) as symbolCount 
        FROM domains d 
        ORDER BY name ASC
    `);
    return rows.map(mapRowToDomain);
  },

  async get(domainId: string): Promise<any | null> {
    const row = sqliteService.get(`
        SELECT d.*, (SELECT COUNT(*) FROM symbols s WHERE s.domain_id = d.id) as symbolCount 
        FROM domains d 
        WHERE d.id = ?
    `, [domainId]);
    return row ? mapRowToDomain(row) : null;
  },

  async getDomain(domainId: string): Promise<any | null> {
    return this.get(domainId);
  },

  async hasDomain(domainId: string): Promise<boolean> {
    const row = sqliteService.get(`SELECT 1 FROM domains WHERE id = ?`, [domainId]);
    return !!row;
  },

  async createDomain(domainId: string, data: any): Promise<any> {
    sqliteService.run(
        `INSERT OR REPLACE INTO domains (id, name, description, invariants, enabled, read_only) VALUES (?, ?, ?, ?, ?, ?)`,
        [domainId, data.name || domainId, data.description || "", JSON.stringify(data.invariants || []), 1, data.readOnly ? 1 : 0]
    );
    return this.get(domainId);
  },

  async updateDomain(domainId: string, data: Partial<{ name: string; description: string; invariants: string[]; enabled: boolean; readOnly: boolean }>): Promise<any> {
    const existing = await this.get(domainId);
    if (!existing) throw new Error(`Domain '${domainId}' not found.`);

    const name = data.name !== undefined ? data.name : existing.name;
    const description = data.description !== undefined ? data.description : existing.description;
    const invariants = data.invariants !== undefined ? JSON.stringify(data.invariants) : JSON.stringify(existing.invariants);
    const enabled = data.enabled !== undefined ? (data.enabled ? 1 : 0) : (existing.enabled ? 1 : 0);
    const readOnly = data.readOnly !== undefined ? (data.readOnly ? 1 : 0) : (existing.readOnly ? 1 : 0);

    sqliteService.run(
        `UPDATE domains SET name = ?, description = ?, invariants = ?, enabled = ?, read_only = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?`,
        [name, description, invariants, enabled, readOnly, domainId]
    );
    return this.get(domainId);
  },

  async upsertDomain(domainId: string, data: any): Promise<any> {
    if (await this.hasDomain(domainId)) {
        return await this.updateDomain(domainId, data);
    }
    return await this.createDomain(domainId, data);
  },

  async deleteDomain(domainId: string): Promise<boolean> {
    const domain = await this.get(domainId);
    if (domain?.readOnly) {
        loggerService.catWarn(LogCategory.DOMAIN, `Attempted to delete read-only domain: ${domainId}`);
        throw new Error(`Domain '${domainId}' is read-only.`);
    }

    loggerService.catInfo(LogCategory.DOMAIN, `Deleting domain: ${domainId}`);
    const result = sqliteService.run(`DELETE FROM domains WHERE id = ?`, [domainId]);
    
    if (result.changes > 0) {
        loggerService.catInfo(LogCategory.DOMAIN, `Successfully deleted domain: ${domainId}`);
        return true;
    }
    
    loggerService.catWarn(LogCategory.DOMAIN, `Failed to delete domain: ${domainId} (not found)`);
    return false;
  },

  // --- Symbol Management ---

  async addSymbol(domainId: string, symbol: SymbolDef): Promise<SymbolDef> {
    await this.bulkUpsertSymbols([symbol], domainId);
    return symbol;
  },

  async bulkUpsert(domainId: string, symbols: SymbolDef[], skipIndexing: boolean = false): Promise<void> {
      await this.bulkUpsertSymbols(symbols, domainId, skipIndexing);
  },

  /**
   * Cross-domain relational bulk upsert.
   */
  async bulkUpsertSymbols(symbols: SymbolDef[], defaultDomainId?: string, skipIndexing: boolean = false): Promise<void> {
    if (symbols.length === 0) return;

    const now = new Date().toISOString();
    
    // Pass 1 & 2: Single heavy transaction for relational integrity
    sqliteService.transaction(() => {
        const stmt = sqliteService.db().prepare(`
            INSERT OR REPLACE INTO symbols (id, domain_id, name, kind, triad, role, macro, facets, activation_conditions, failure_mode, symbol_tag, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        // First pass: symbols
        for (const symbol of symbols) {
            const domainId = symbol.symbol_domain || symbol.domain_id || defaultDomainId;
            if (!domainId) continue;

            stmt.run(
                symbol.id,
                domainId,
                symbol.name,
                symbol.kind || 'pattern',
                symbol.triad,
                symbol.role,
                symbol.macro,
                JSON.stringify(symbol.facets || {}),
                JSON.stringify(symbol.activation_conditions || []),
                symbol.failure_mode,
                symbol.symbol_tag || '',
                now
            );
        }

        // Second pass: links
        const deleteLinks = sqliteService.db().prepare(`DELETE FROM symbol_links WHERE source_id = ?`);
        const insertLink = sqliteService.db().prepare(`INSERT INTO symbol_links (source_id, target_id, link_type, bidirectional) VALUES (?, ?, ?, ?)`);

        for (const symbol of symbols) {
            deleteLinks.run(symbol.id);
            if (symbol.linked_patterns && symbol.linked_patterns.length > 0) {
                for (const link of symbol.linked_patterns) {
                    const targetId = typeof link === 'string' ? link : link.id;
                    const linkType = typeof link === 'string' ? 'relates_to' : (link.link_type || 'relates_to');
                    const bidirectional = typeof link === 'string' ? 0 : (link.bidirectional ? 1 : 0);
                    try {
                        insertLink.run(symbol.id, targetId, linkType, bidirectional);
                    } catch (e) {}
                }
            }
        }
    })();

    // Efficient Batch Indexing (Optionally skipped for project imports which handle it separately)
    if (!skipIndexing) {
        await lancedbService.indexBatch(symbols);
    }

    // Events
    for (const s of symbols) {
        eventBusService.emitKernelEvent(KernelEventType.SYMBOL_UPSERTED, { 
            symbolId: s.id, 
            domainId: s.symbol_domain || s.domain_id || defaultDomainId 
        });
    }
  },

  async findById(id: string): Promise<SymbolDef | null> {
    const row = sqliteService.get(`SELECT * FROM symbols WHERE id = ?`, [id]);
    if (!row) return null;

    const links = sqliteService.all(`SELECT target_id as id, link_type, bidirectional FROM symbol_links WHERE source_id = ?`, [id]) as any[];
    return mapRowToSymbol(row, links.map(l => ({ ...l, bidirectional: !!l.bidirectional })));
  },

  async deleteSymbol(domainId: string, symbolId: string): Promise<boolean> {
    const domain = await this.get(domainId);
    if (domain?.readOnly) throw new Error(`Domain '${domainId}' is read-only.`);

    const result = sqliteService.run(`DELETE FROM symbols WHERE id = ? AND domain_id = ?`, [symbolId, domainId]);
    if (result.changes > 0) {
        eventBusService.emitKernelEvent(KernelEventType.SYMBOL_DELETED, { symbolId, domainId });
        return true;
    }
    return false;
  },

  async getSymbols(domainId: string): Promise<SymbolDef[]> {
    const rows = sqliteService.all(`SELECT * FROM symbols WHERE domain_id = ?`, [domainId]) as any[];
    const symbols: SymbolDef[] = [];
    for (const row of rows) {
        const links = sqliteService.all(`SELECT target_id as id, link_type, bidirectional FROM symbol_links WHERE source_id = ?`, [row.id]) as any[];
        symbols.push(mapRowToSymbol(row, links.map(l => ({ ...l, bidirectional: !!l.bidirectional }))));
    }
    return symbols;
  },

  async getAllSymbols(): Promise<SymbolDef[]> {
    const rows = sqliteService.all(`SELECT * FROM symbols`) as any[];
    const symbols: SymbolDef[] = [];
    for (const row of rows) {
        const links = sqliteService.all(`SELECT target_id as id, link_type, bidirectional FROM symbol_links WHERE source_id = ?`, [row.id]) as any[];
        symbols.push(mapRowToSymbol(row, links.map(l => ({ ...l, bidirectional: !!l.bidirectional }))));
    }
    return symbols;
  },

  async findSymbolsByTags(tags: string[]): Promise<SymbolDef[]> {
    if (tags.length === 0) return [];
    const placeholders = tags.map(() => '?').join(',');
    const rows = sqliteService.all(`
        SELECT s.* FROM symbols s
        JOIN domains d ON s.domain_id = d.id
        WHERE d.enabled = 1 AND s.symbol_tag IN (${placeholders})
    `, tags) as any[];
    const symbols: SymbolDef[] = [];
    for (const row of rows) {
        const links = sqliteService.all(`SELECT target_id as id, link_type, bidirectional FROM symbol_links WHERE source_id = ?`, [row.id]) as any[];
        symbols.push(mapRowToSymbol(row, links.map(l => ({ ...l, bidirectional: !!l.bidirectional }))));
    }
    return symbols;
  },

  async getRecentSymbols(limit: number = 50): Promise<SymbolDef[]> {
    const rows = sqliteService.all(`
        SELECT s.* FROM symbols s
        JOIN domains d ON s.domain_id = d.id
        WHERE d.enabled = 1
        ORDER BY s.updated_at DESC LIMIT ?
    `, [limit]) as any[];
    const symbols: SymbolDef[] = [];
    for (const row of rows) {
        const links = sqliteService.all(`SELECT target_id as id, link_type, bidirectional FROM symbol_links WHERE source_id = ?`, [row.id]) as any[];
        symbols.push(mapRowToSymbol(row, links.map(l => ({ ...l, bidirectional: !!l.bidirectional }))));
    }
    return symbols;
  },

  async getSymbolCount(): Promise<number> {
    const row = sqliteService.get(`SELECT COUNT(*) as count FROM symbols`);
    return row?.count || 0;
  },

  async getDomainCount(): Promise<number> {
    const row = sqliteService.get(`SELECT COUNT(*) as count FROM domains`);
    return row?.count || 0;
  },

  async ensureVectorIndex(): Promise<void> {
    const vectorCount = await lancedbService.countCollection();
    const sqlCount = await this.getSymbolCount();

    if (vectorCount === 0 && sqlCount > 0) {
        loggerService.catInfo(LogCategory.KERNEL, `Vector index is empty. Indexing all ${sqlCount} symbols...`);
        const allSymbols = await this.getAllSymbols();
        await lancedbService.indexBatch(allSymbols, (indexed, total) => {
            if (indexed % 100 === 0 || indexed === total) {
                loggerService.catInfo(LogCategory.KERNEL, `Indexing progress: ${indexed}/${total}`);
            }
        });
        loggerService.catInfo(LogCategory.KERNEL, `Vector index sync complete.`);
    } else {
        loggerService.catInfo(LogCategory.KERNEL, `Vector index check: ${vectorCount} vectors, ${sqlCount} sql symbols.`);
    }
  },

  async search(query: string, limit: number = 10, filter?: any): Promise<VectorSearchResult[]> {
    if (!filter || (!filter.symbol_domain && !filter.domain)) {
        // Automatically filter by enabled domains
        const enabledDomains = (sqliteService.all(`SELECT id FROM domains WHERE enabled = 1`) as any[]).map(r => r.id);
        if (enabledDomains.length > 0) {
            filter = { ...filter, symbol_domain: enabledDomains };
        } else {
            // If no domains are enabled, return nothing
            return [];
        }
    }
    return await lancedbService.search(query, limit, filter);
  },

  async clearAll(): Promise<void> {
    sqliteService.transaction(() => {
        sqliteService.run(`DELETE FROM symbol_links`);
        sqliteService.run(`DELETE FROM symbols`);
        sqliteService.run(`DELETE FROM domains WHERE id NOT IN ('root', 'user', 'state')`);
    })();
  },

  // Legacy/Compatibility methods
  async clearCache(): Promise<void> {
    // SQLite doesn't need explicit cache clearing in this implementation
  },

  getDomainKey(domainId: string): string {
    return `domain:${domainId}`;
  },

  canAccessDomain(): boolean {
    return true; // Single user mode
  },

  ensureWritableDomain(domain: any) {
    if (domain.readOnly) throw new Error(`Domain is read-only.`);
  }
};
