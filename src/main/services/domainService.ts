import { SymbolDef, SymbolLink, VectorSearchResult } from '../types.js';
import { lancedbService } from './lancedbService.js';
import { sqliteService } from './sqliteService.js';
import { loggerService, LogCategory } from './loggerService.js';
import { eventBusService, KernelEventType } from './eventBusService.js';
import { settingsService } from './settingsService.js';
import { getClient, getGeminiClient, extractJson } from './inferenceService.js';
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
    lattice: row.lattice ? JSON.parse(row.lattice) : undefined,
    persona: row.persona ? JSON.parse(row.persona) : undefined,
    data: row.data ? JSON.parse(row.data) : undefined,
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
            INSERT OR REPLACE INTO symbols (id, domain_id, name, kind, triad, role, macro, lattice, persona, data, facets, activation_conditions, failure_mode, symbol_tag, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        // First pass: symbols
        for (const symbol of symbols) {
            const domainId = symbol.symbol_domain || symbol.domain_id || defaultDomainId;
            if (!domainId) continue;

            // Merge invocations into activation_conditions (synonyms)
            const conditions = new Set([
                ...(symbol.activation_conditions || []),
                ...(symbol.invocations || []),
                ...(symbol.persona?.activation_conditions || [])
            ]);

            stmt.run(
                symbol.id,
                domainId,
                symbol.name,
                symbol.kind || 'pattern',
                symbol.triad,
                symbol.role,
                symbol.macro,
                JSON.stringify(symbol.lattice || null),
                JSON.stringify(symbol.persona || null),
                JSON.stringify(symbol.data || null),
                JSON.stringify(symbol.facets || {}),
                JSON.stringify(Array.from(conditions)),
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

  async mergeSymbols(canonicalId: string, redundantId: string): Promise<void> {
    loggerService.catInfo(LogCategory.DOMAIN, `Merging symbol ${redundantId} into ${canonicalId}`);

    const canonical = await this.findById(canonicalId);
    const redundant = await this.findById(redundantId);

    if (!canonical || !redundant) {
      throw new Error(`Symbol not found: ${!canonical ? canonicalId : redundantId}`);
    }

    // 1. Synthesis via Fast Model
    let synthesized = { ...canonical };
    try {
        const settings = await settingsService.getInferenceSettings();
        const fastModel = settings.fastModel;
        
        if (fastModel) {
            const prompt = `Synthesize these two symbolic definitions from a knowledge graph into one canonical symbol.
            
            Canonical Symbol (${canonicalId}):
            ${JSON.stringify({ 
                name: canonical.name, 
                role: canonical.role, 
                macro: canonical.macro, 
                kind: canonical.kind,
                lattice: canonical.lattice,
                persona: canonical.persona,
                data: canonical.data,
                invocations: canonical.invocations,
                activation_conditions: canonical.activation_conditions, 
                updated_at: canonical.updated_at 
            })}
            
            Redundant Symbol (${redundantId}):
            ${JSON.stringify({ 
                name: redundant.name, 
                role: redundant.role, 
                macro: redundant.macro, 
                kind: redundant.kind,
                lattice: redundant.lattice,
                persona: redundant.persona,
                data: redundant.data,
                invocations: redundant.invocations,
                activation_conditions: redundant.activation_conditions, 
                updated_at: redundant.updated_at 
            })}
            
            CRITERIA:
            1. Determine if they represent the EXACT same concept or if one is a direct evolution of the other.
            2. If they are fundamentally different, or if merging would lose critical distinct nuance, you MUST reject the merge.
            3. Prioritize the identity and structure of the Canonical Symbol.
            
            OUTPUT:
            Return valid JSON only:
            {
              "canMerge": true/false,
              "reason": "Brief explanation of why a merge is or isn't appropriate",
              "synthesized": {
                 "name": "...",
                 "role": "...",
                 "macro": "...",
                 "kind": "...",
                 "lattice": { ... },
                 "persona": { ... },
                 "data": { ... },
                 "invocations": [...],
                 "activation_conditions": [...]
              }
            }`;

            let response: any = {};
            if (settings.provider === 'gemini') {
                const client = await getGeminiClient();
                const model = client.getGenerativeModel({ 
                    model: fastModel, 
                    generationConfig: { responseMimeType: "application/json", maxOutputTokens: 1000 } 
                });
                const result = await model.generateContent(prompt);
                response = extractJson(result.response.text());
            } else {
                const client = await getClient();
                const result = await client.chat.completions.create({ 
                    model: fastModel, 
                    messages: [{ role: "user", content: prompt }],
                    max_tokens: 1000
                });
                response = extractJson(result.choices[0]?.message?.content || "{}");
            }

            if (response.canMerge === false) {
                loggerService.catWarn(LogCategory.DOMAIN, `Merge rejected by model: ${canonicalId} and ${redundantId} are fundamentally different.`);
                return;
            }

            if (response.canMerge === true && response.synthesized) {
                synthesized = { 
                    ...canonical, 
                    ...response.synthesized, 
                    id: canonicalId,
                    facets: { ...(canonical.facets || {}), ...(response.synthesized.facets || {}) }
                }; 
                loggerService.catInfo(LogCategory.DOMAIN, `Model-assisted synthesis complete for ${canonicalId}`);
            }
        }
    } catch (err) {
        loggerService.catError(LogCategory.DOMAIN, `Synthesis failed, falling back to basic merge`, { error: err });
    }

    // 2. Move links from redundant to synthesized
    if (redundant.linked_patterns) {
      if (!synthesized.linked_patterns) synthesized.linked_patterns = [];

      for (const link of redundant.linked_patterns) {
        const targetId = typeof link === 'string' ? link : link.id;
        if (targetId !== canonicalId && !synthesized.linked_patterns.some(l => (typeof l === 'string' ? l : l.id) === targetId)) {
          synthesized.linked_patterns.push(link);
        }
      }
    }

    // 3. Save synthesized symbol
    await this.addSymbol(synthesized.symbol_domain, synthesized);

    // 4. Update all global links pointing to redundant to point to canonical
    sqliteService.run(`UPDATE symbol_links SET target_id = ? WHERE target_id = ?`, [canonicalId, redundantId]);

    // 5. Delete redundant symbol
    await this.deleteSymbol(redundant.symbol_domain, redundantId);
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
    loggerService.catInfo(LogCategory.KERNEL, `Ensuring vector index integrity...`);
    const allSymbols = await this.getAllSymbols();
    const stats = await lancedbService.syncLanceDB(allSymbols);
    loggerService.catInfo(LogCategory.KERNEL, `Vector index sync complete.`, stats);
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
