import { SymbolDef, SymbolLink, VectorSearchResult } from '../types.js';
import { lancedbService } from './lancedbService.js';
import { sqliteService } from './sqliteService.js';
import { loggerService, LogCategory } from './loggerService.js';
import { eventBusService, KernelEventType } from './eventBusService.js';
import { getClient, getGeminiClient, extractJson, callFastInference } from './inferenceService.js';
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

export const RECIPROCAL_MAP: Record<string, string> = {
    'relates_to': 'relates_to',
    'depends_on': 'required_by',
    'required_by': 'depends_on',
    'part_of': 'contains',
    'contains': 'part_of',
    'instance_of': 'exemplifies',
    'exemplifies': 'instance_of',
    'informs': 'informed_by',
    'informed_by': 'informs',
    'constrained_by': 'limits',
    'limits': 'constrained_by',
    'triggers': 'triggered_by',
    'triggered_by': 'triggers',
    'negates': 'negated_by',
    'negated_by': 'negates',
    'evolved_from': 'evolved_into',
    'evolved_into': 'evolved_from',
    'implements': 'implemented_by',
    'implemented_by': 'implements',
    'extends': 'extended_by',
    'extended_by': 'extends',
    'synthesized_from': 'synthesis_of',
    'synthesis_of': 'synthesized_from',
    'derived_from': 'source_of',
    'source_of': 'derived_from',
    'feeds_into': 'receives_data_from',
    'receives_data_from': 'feeds_into',
    'orchestrates': 'orchestrated_by',
    'orchestrated_by': 'orchestrates',
    'monitors': 'monitored_by',
    'monitored_by': 'monitors',
    'validates': 'validated_by',
    'validated_by': 'validates',
    'enables': 'enabled_by',
    'enabled_by': 'enables',
    'executes': 'executed_by',
    'executed_by': 'executes',
    'documents': 'documented_by',
    'documented_by': 'documents',
    'contrasts_with': 'contrasts_with',
    'references': 'referenced_by',
    'referenced_by': 'references',
    'grounds_in': 'reality_for',
    'reality_for': 'grounds_in'
};

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
        const deleteSpecificLink = sqliteService.db().prepare(`DELETE FROM symbol_links WHERE source_id = ? AND target_id = ?`);
        const getOldLinks = sqliteService.db().prepare(`SELECT target_id FROM symbol_links WHERE source_id = ?`);
        const insertLink = sqliteService.db().prepare(`INSERT INTO symbol_links (source_id, target_id, link_type) VALUES (?, ?, ?)`);

        for (const symbol of symbols) {
            // 1. Find links that are about to be removed to handle reciprocals
            const oldLinks = getOldLinks.all(symbol.id) as { target_id: string }[];
            const newTargetIds = new Set((symbol.linked_patterns || []).map(l => typeof l === 'string' ? l : l.id));

            for (const old of oldLinks) {
                if (!newTargetIds.has(old.target_id)) {
                    // This link is being removed from the source. 
                    // We must also remove the reciprocal link from the target back to this source.
                    deleteSpecificLink.run(old.target_id, symbol.id);
                }
            }

            // 2. Standard outgoing link refresh
            deleteLinks.run(symbol.id);
            if (symbol.linked_patterns && symbol.linked_patterns.length > 0) {
                for (const link of symbol.linked_patterns) {
                    const targetId = typeof link === 'string' ? link : link.id;
                    const linkType = typeof link === 'string' ? 'relates_to' : (link.link_type || 'relates_to');
                    
                    try {
                        // 3. Insert original link
                        insertLink.run(symbol.id, targetId, linkType);

                        // 4. Automatic Reciprocation
                        const reciprocalType = RECIPROCAL_MAP[linkType] || 'relates_to';
                        insertLink.run(targetId, symbol.id, reciprocalType);
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

    const links = sqliteService.all(`SELECT target_id as id, link_type FROM symbol_links WHERE source_id = ?`, [id]) as any[];
    return mapRowToSymbol(row, links);
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
        const prompt = `Synthesize these two symbolic definitions from a knowledge graph into one canonical symbol.
        
        Canonical Symbol Candidate (${canonicalId}) in domain "${canonical.symbol_domain}":
        ${JSON.stringify({ 
            id: canonical.id,
            domain: canonical.symbol_domain,
            name: canonical.name, 
            role: canonical.role, 
            macro: canonical.macro, 
            kind: canonical.kind,
            lattice: canonical.lattice,
            persona: canonical.persona,
            data: canonical.data,
            activation_conditions: canonical.activation_conditions, 
            updated_at: canonical.updated_at 
        })}
        
        Redundant Symbol Candidate (${redundantId}) in domain "${redundant.symbol_domain}":
        ${JSON.stringify({ 
            id: redundant.id,
            domain: redundant.symbol_domain,
            name: redundant.name, 
            role: redundant.role, 
            macro: redundant.macro, 
            kind: redundant.kind,
            lattice: redundant.lattice,
            persona: redundant.persona,
            data: redundant.data,
            activation_conditions: redundant.activation_conditions, 
            updated_at: redundant.updated_at 
        })}
        
        CRITERIA:
        1. Determine if they represent the EXACT same concept or if one is a direct evolution of the other.
        2. SYNTHESIZE a HIGHER-LEVEL concept if they represent related ideas at different levels of abstraction.
        3. CHOOSE the most descriptive and canonical "name" based on domain specificity (User > Root > State) and technical accuracy.
        4. You MUST preserve and deduplicate all "activation_conditions" from both symbols.
        5. MERGE all fields (macros, roles, facets) if the symbols have evolved, ensuring no knowledge is lost.
        6. If they are fundamentally different concepts that should NOT be merged, output { "canMerge": false }.
        
        OUTPUT (Valid JSON only):
        {
          "canMerge": true/false,
          "reason": "Brief explanation of synthesis approach and why this name was chosen",
          "synthesized": {
             "name": "Synthesized canonical name",
             "role": "Synthesized role/definition",
             "macro": "Merged and evolved symbolic macro logic",
             "kind": "pattern/lattice/persona/data",
             "activation_conditions": ["merged", "unique", "conditions", ...],
             "lattice": { ... },
             "persona": { ... },
             "data": { ... }
          }
        }`;

        const fastText = await callFastInference([{ role: "user", content: prompt }], 1000);
        const response = await extractJson(fastText);

        if (response.canMerge === false) {
            loggerService.catWarn(LogCategory.DOMAIN, `Merge rejected by model: ${response.reason || 'Fundamentally different'}`);
            return;
        }

        if (response.canMerge === true && response.synthesized) {
            // Merge facets intelligently
            const mergedFacets = {
                ...(canonical.facets || {}),
                ...(redundant.facets || {}),
                ...(response.synthesized.facets || {})
            };

            // Deduplicate array facets
            if (mergedFacets.gate) mergedFacets.gate = Array.from(new Set([...(canonical.facets?.gate || []), ...(redundant.facets?.gate || []), ...(response.synthesized.facets?.gate || [])]));
            if (mergedFacets.substrate) mergedFacets.substrate = Array.from(new Set([...(canonical.facets?.substrate || []), ...(redundant.facets?.substrate || []), ...(response.synthesized.facets?.substrate || [])]));
            if (mergedFacets.invariants) mergedFacets.invariants = Array.from(new Set([...(canonical.facets?.invariants || []), ...(redundant.facets?.invariants || []), ...(response.synthesized.facets?.invariants || [])]));

            synthesized = { 
                ...canonical, 
                ...response.synthesized, 
                id: canonicalId,
                facets: mergedFacets
            }; 
            loggerService.catInfo(LogCategory.DOMAIN, `Model-assisted synthesis complete for ${canonicalId}`, { reason: response.reason });
        }
    } catch (err) {
        loggerService.catError(LogCategory.DOMAIN, `Synthesis failed, falling back to basic merge`, { error: err });
    }

    // 2. Move and merge links (Type-Aware Deduplication)
    if (!synthesized.linked_patterns) synthesized.linked_patterns = [];
    const existingLinkKeys = new Set(synthesized.linked_patterns.map(l => {
        const targetId = typeof l === 'string' ? l : l.id;
        const type = typeof l === 'string' ? 'relates_to' : (l.link_type || 'relates_to');
        return `${targetId}:${type}`;
    }));

    if (redundant.linked_patterns) {
      for (const link of redundant.linked_patterns) {
        const targetId = typeof link === 'string' ? link : link.id;
        const type = typeof link === 'string' ? 'relates_to' : (link.link_type || 'relates_to');
        const key = `${targetId}:${type}`;

        if (targetId !== canonicalId && !existingLinkKeys.has(key)) {
          synthesized.linked_patterns.push(link);
          existingLinkKeys.add(key);
        }
      }
    }

    // 3. Save synthesized symbol
    await this.addSymbol(synthesized.symbol_domain, synthesized);

    // 4. Update all global links pointing to redundant to point to canonical
    // We use a pattern that handles potential duplicates (primary key collisions)
    sqliteService.transaction(() => {
        // Move incoming links: if a link from S -> Redundant already exists as S -> Canonical, the insert will ignore it
        sqliteService.run(`
            INSERT OR IGNORE INTO symbol_links (source_id, target_id, link_type)
            SELECT source_id, ? as target_id, link_type 
            FROM symbol_links 
            WHERE target_id = ?
        `, [canonicalId, redundantId]);

        // Now safe to delete all links pointing to redundant
        sqliteService.run(`DELETE FROM symbol_links WHERE target_id = ?`, [redundantId]);
        
        // Also clean up any outgoing links from the redundant symbol that were missed (they should be gone via deleteSymbol anyway)
        sqliteService.run(`DELETE FROM symbol_links WHERE source_id = ?`, [redundantId]);
    });

    // 5. Delete redundant symbol
    await this.deleteSymbol(redundant.symbol_domain, redundantId);
  },

  async renameSymbol(domainId: string, oldId: string, newId: string): Promise<void> {
    if (oldId === newId) return;
    loggerService.catInfo(LogCategory.DOMAIN, `Renaming symbol ${oldId} -> ${newId} in domain ${domainId}`);

    const symbol = await this.findById(oldId);
    if (!symbol) throw new Error(`Symbol ${oldId} not found.`);

    const newSymbol = { ...symbol, id: newId };

    sqliteService.transaction(() => {
        // 1. Create the new symbol
        this.addSymbol(domainId, newSymbol);

        // 2. Move incoming links
        sqliteService.run(`
            UPDATE symbol_links SET target_id = ? WHERE target_id = ?
        `, [newId, oldId]);

        // 3. Move outgoing links (source_id is part of PK)
        sqliteService.run(`
            INSERT OR IGNORE INTO symbol_links (source_id, target_id, link_type)
            SELECT ? as source_id, target_id, link_type 
            FROM symbol_links 
            WHERE source_id = ?
        `, [newId, oldId]);

        // 4. Delete the old symbol (cascades its outgoing links)
        sqliteService.run(`DELETE FROM symbols WHERE id = ?`, [oldId]);
    });

    // 5. Re-index
    await lancedbService.deleteSymbol(oldId);
    await lancedbService.indexBatch([newSymbol]);
  },

  async relocateSymbol(symbolId: string, oldDomainId: string, newDomainId: string): Promise<void> {
    if (oldDomainId === newDomainId) return;
    loggerService.catInfo(LogCategory.DOMAIN, `Relocating symbol ${symbolId} from ${oldDomainId} to ${newDomainId}`);

    const symbol = await this.findById(symbolId);
    if (!symbol) throw new Error(`Symbol ${symbolId} not found.`);

    sqliteService.run(`
        UPDATE symbols SET domain_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `, [newDomainId, symbolId]);

    // Update vector store metadata
    await lancedbService.indexBatch([{ ...symbol, symbol_domain: newDomainId }]);
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
        const links = sqliteService.all(`SELECT target_id as id, link_type FROM symbol_links WHERE source_id = ?`, [row.id]) as any[];
        symbols.push(mapRowToSymbol(row, links));
    }
    return symbols;
  },

  async getAllSymbols(): Promise<SymbolDef[]> {
    const rows = sqliteService.all(`SELECT * FROM symbols`) as any[];
    const symbols: SymbolDef[] = [];
    for (const row of rows) {
        const links = sqliteService.all(`SELECT target_id as id, link_type FROM symbol_links WHERE source_id = ?`, [row.id]) as any[];
        symbols.push(mapRowToSymbol(row, links));
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
        const links = sqliteService.all(`SELECT target_id as id, link_type FROM symbol_links WHERE source_id = ?`, [row.id]) as any[];
        symbols.push(mapRowToSymbol(row, links));
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
        const links = sqliteService.all(`SELECT target_id as id, link_type FROM symbol_links WHERE source_id = ?`, [row.id]) as any[];
        symbols.push(mapRowToSymbol(row, links));
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

  async getLinkCount(): Promise<number> {
    const row = sqliteService.get(`SELECT COUNT(*) as count FROM symbol_links`);
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
