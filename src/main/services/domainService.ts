import { SymbolDef, SymbolLink, VectorSearchResult, isUserSpecificDomain } from '../types.js';
import { lancedbService } from './lancedbService.js';
import { sqliteService } from './sqliteService.js';
import { symbolCacheService } from './symbolCacheService.js';
import { eventBusService, KernelEventType } from './eventBusService.js';
import { loggerService } from './loggerService.js';
import { USER_DOMAIN_TEMPLATE, STATE_DOMAIN_TEMPLATE } from '../symbolic_system/domain_templates.js';

const mapRowToDomain = (row: any): any => ({
    id: row.id,
    name: row.name,
    description: row.description,
    invariants: row.invariants ? JSON.parse(row.invariants) : [],
    enabled: !!row.enabled,
    readOnly: !!row.read_only,
    lastUpdated: row.last_updated
});

const mapRowToSymbol = (row: any, links: SymbolLink[] = []): SymbolDef => ({
    id: row.id,
    domain_id: row.domain_id,
    symbol_domain: row.domain_id,
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
  async init(domainId: string, name: string): Promise<any> {
    const existing = sqliteService.get(`SELECT * FROM domains WHERE id = ?`, [domainId]);
    if (existing) return mapRowToDomain(existing);

    let template: any = {};
    if (domainId === 'user') template = USER_DOMAIN_TEMPLATE;
    else if (domainId === 'state') template = STATE_DOMAIN_TEMPLATE;

    sqliteService.run(
        `INSERT INTO domains (id, name, description, invariants, enabled, read_only) VALUES (?, ?, ?, ?, ?, ?)`,
        [domainId, template.name || name, template.description || "", JSON.stringify(template.invariants || []), 1, 0]
    );

    if (template.symbols && template.symbols.length > 0) {
        for (const sym of template.symbols) {
            await this.addSymbol(domainId, sym);
        }
    }

    return this.get(domainId);
  },

  async listDomains(): Promise<string[]> {
    const rows = sqliteService.all(`SELECT id FROM domains`);
    return rows.map(r => r.id);
  },

  async getMetadata(): Promise<any[]> {
    const rows = sqliteService.all(`SELECT * FROM domains ORDER BY name ASC`);
    return rows.map(mapRowToDomain);
  },

  async get(domainId: string): Promise<any | null> {
    const row = sqliteService.get(`SELECT * FROM domains WHERE id = ?`, [domainId]);
    return row ? mapRowToDomain(row) : null;
  },

  async hasDomain(domainId: string): Promise<boolean> {
    const row = sqliteService.get(`SELECT 1 FROM domains WHERE id = ?`, [domainId]);
    return !!row;
  },

  async createDomain(domainId: string, data: any): Promise<any> {
    sqliteService.run(
        `INSERT INTO domains (id, name, description, invariants, enabled, read_only) VALUES (?, ?, ?, ?, ?, ?)`,
        [domainId, data.name || domainId, data.description || "", JSON.stringify(data.invariants || []), 1, 0]
    );
    return this.get(domainId);
  },

  async addSymbol(domainId: string, symbol: SymbolDef): Promise<SymbolDef> {
    const now = new Date().toISOString();
    
    sqliteService.transaction(() => {
        sqliteService.run(
            `INSERT OR REPLACE INTO symbols (id, domain_id, name, kind, triad, role, macro, facets, activation_conditions, failure_mode, updated_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
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
                now
            ]
        );

        // Update links
        sqliteService.run(`DELETE FROM symbol_links WHERE source_id = ?`, [symbol.id]);
        if (symbol.linked_patterns && symbol.linked_patterns.length > 0) {
            const insertLink = sqliteService.db().prepare(`INSERT INTO symbol_links (source_id, target_id, link_type, bidirectional) VALUES (?, ?, ?, ?)`);
            for (const link of symbol.linked_patterns) {
                insertLink.run(symbol.id, link.id, link.link_type || 'relates_to', link.bidirectional ? 1 : 0);
            }
        }
    })();

    await lancedbService.indexSymbol(symbol);
    eventBusService.emitKernelEvent(KernelEventType.SYMBOL_UPSERTED, { symbolId: symbol.id, domainId });
    return symbol;
  },

  async bulkUpsert(domainId: string, symbols: SymbolDef[]): Promise<void> {
    const domain = await this.get(domainId);
    if (!domain) throw new Error(`Domain '${domainId}' not found.`);
    for (const s of symbols) {
        await this.addSymbol(domainId, s);
    }
  },

  async findById(id: string): Promise<SymbolDef | null> {
    const row = sqliteService.get(`SELECT * FROM symbols WHERE id = ?`, [id]);
    if (!row) return null;

    const links = sqliteService.all(`SELECT target_id as id, link_type, bidirectional FROM symbol_links WHERE source_id = ?`, [id]);
    return mapRowToSymbol(row, links.map(l => ({ ...l, bidirectional: !!l.bidirectional })));
  },

  async getSymbols(domainId: string): Promise<SymbolDef[]> {
    const rows = sqliteService.all(`SELECT * FROM symbols WHERE domain_id = ?`, [domainId]);
    const symbols: SymbolDef[] = [];
    for (const row of rows) {
        const links = sqliteService.all(`SELECT target_id as id, link_type, bidirectional FROM symbol_links WHERE source_id = ?`, [row.id]);
        symbols.push(mapRowToSymbol(row, links.map(l => ({ ...l, bidirectional: !!l.bidirectional }))));
    }
    return symbols;
  },

  async getAllSymbols(): Promise<SymbolDef[]> {
    const rows = sqliteService.all(`SELECT * FROM symbols`);
    const symbols: SymbolDef[] = [];
    for (const row of rows) {
        const links = sqliteService.all(`SELECT target_id as id, link_type, bidirectional FROM symbol_links WHERE source_id = ?`, [row.id]);
        symbols.push(mapRowToSymbol(row, links.map(l => ({ ...l, bidirectional: !!l.bidirectional }))));
    }
    return symbols;
  },

  async search(query: string, limit: number = 10, filter?: any): Promise<VectorSearchResult[]> {
    return await lancedbService.search(query, limit, filter);
  }
};
