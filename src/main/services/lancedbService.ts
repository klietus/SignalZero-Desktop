import * as lancedb from '@lancedb/lancedb';
import { join } from 'path';
import { app } from 'electron';
import fs from 'fs';
import { embedTexts } from './embeddingService.js';

// Types (Mirrored from LocalNode/types.ts)
export interface VectorSearchResult {
    id: string;
    score: number;
    metadata: any;
    document: string;
}

export interface SymbolDef {
    id: string;
    name: string;
    triad: string;
    symbol_domain: string;
    symbol_tag?: string;
    kind?: string;
    role: string;
    macro?: string;
    activation_conditions?: string[];
    facets?: {
        invariants?: string[];
        [key: string]: any;
    };
    lattice?: any;
    persona?: any;
    data?: {
        source?: string;
        status?: string;
    };
    [key: string]: any;
}

let db: lancedb.Connection | null = null;
const COLLECTION_NAME = 'symbols';
const DELTAS_COLLECTION_NAME = 'monitoring_deltas';

const getDb = async () => {
    if (db) return db;
    const userDataPath = app.getPath('userData');
    const dbPath = join(userDataPath, 'lancedb');
    
    if (!fs.existsSync(dbPath)) {
        fs.mkdirSync(dbPath, { recursive: true });
    }

    db = await lancedb.connect(dbPath);
    return db;
};

const getTable = async () => {
    const conn = await getDb();
    const tableNames = await conn.tableNames();
    
    if (tableNames.includes(COLLECTION_NAME)) {
        return await conn.openTable(COLLECTION_NAME);
    }
    return null;
};

const getDeltasTable = async () => {
    const conn = await getDb();
    const tableNames = await conn.tableNames();
    
    if (tableNames.includes(DELTAS_COLLECTION_NAME)) {
        return await conn.openTable(DELTAS_COLLECTION_NAME);
    }
    return null;
};

export const symbolToContent = (symbol: SymbolDef) => {
    return `
        Symbol: ${symbol.name} (${symbol.id})
        Triad: ${symbol.triad}
        Domain: ${symbol.symbol_domain}
        Tag: ${symbol.symbol_tag || 'N/A'}
        Kind: ${symbol.kind || 'pattern'}
        Role: ${symbol.role}
        Macro: ${symbol.macro || ''}
        Activation Conditions: ${(symbol.activation_conditions || []).join(', ')}
        Invariants: ${(symbol.facets?.invariants || []).join(', ')}
        Description: ${JSON.stringify(symbol.facets || {})}
        Lattice: ${symbol.kind === 'lattice' ? JSON.stringify(symbol.lattice) : 'N/A'}
        Persona: ${symbol.kind === 'persona' ? JSON.stringify(symbol.persona) : 'N/A'}
        Data Source: ${symbol.kind === 'data' ? symbol.data?.source : 'N/A'}
        Data Status: ${symbol.kind === 'data' ? symbol.data?.status : 'N/A'}
    `.trim().replace(/\s+/g, ' ');
};

export const lancedbService = {
    async healthCheck(): Promise<boolean> {
        try {
            await getDb();
            return true;
        } catch (e) {
            return false;
        }
    },

    async indexSymbol(symbol: SymbolDef): Promise<boolean> {
        return (await this.indexBatch([symbol])) > 0;
    },

    /**
     * High-performance batch indexing with chunked embedding generation.
     */
    async indexBatch(symbols: SymbolDef[], onProgress?: (indexed: number, total: number) => void): Promise<number> {
        if (symbols.length === 0) return 0;

        const allRecords: any[] = [];
        const EMBED_CHUNK_SIZE = 10; // Conservative chunk size for ONNX Stability

        try {
            for (let i = 0; i < symbols.length; i += EMBED_CHUNK_SIZE) {
                const chunk = symbols.slice(i, i + EMBED_CHUNK_SIZE);
                const contents = chunk.map(symbolToContent);
                const vectors = await embedTexts(contents);
                
                for (let j = 0; j < chunk.length; j++) {
                    const symbol = chunk[j];
                    allRecords.push({
                        vector: vectors[j],
                        id: symbol.id,
                        text: contents[j],
                        name: symbol.name,
                        triad: symbol.triad,
                        domain: symbol.symbol_domain,
                        symbol_domain: symbol.symbol_domain,
                        symbol_tag: symbol.symbol_tag,
                        role: symbol.role,
                        macro: symbol.macro,
                        kind: symbol.kind || 'pattern',
                        updated_at: symbol.updated_at || new Date().toISOString()
                    });
                }
                
                if (onProgress) {
                    onProgress(Math.min(i + EMBED_CHUNK_SIZE, symbols.length), symbols.length);
                }
            }

            const conn = await getDb();
            let table = await getTable();

            if (!table) {
                await conn.createTable(COLLECTION_NAME, allRecords);
            } else {
                try {
                    const ids = symbols.map(s => `'${s.id}'`).join(',');
                    await table.delete(`id IN (${ids})`);
                    await table.add(allRecords);
                } catch (addErr: any) {
                    // Check if this is a schema mismatch error
                    if (addErr.message?.includes('schema') || addErr.message?.includes('field')) {
                        console.warn("[LanceDB] Schema mismatch detected during indexing. Resetting collection for migration...");
                        await conn.dropTable(COLLECTION_NAME);
                        await conn.createTable(COLLECTION_NAME, allRecords);
                    } else {
                        throw addErr;
                    }
                }
            }

            return symbols.length;
        } catch (e) {
            console.error("[LanceDB] Batch indexing error", e);
            return 0;
        }
    },

    async deleteSymbol(symbolId: string): Promise<boolean> {
        try {
            const table = await getTable();
            if (table) {
                await table.delete(`id = '${symbolId}'`);
            }
            return true;
        } catch (e) {
            console.error("[LanceDB] Delete failed", e);
            return false;
        }
    },

    async search(query: string, nResults: number = 5, filter?: Record<string, any>): Promise<VectorSearchResult[]> {
        try {
            const table = await getTable();
            if (!table) return [];

            const [queryVector] = await embedTexts([query]);
            
            let searchBuilder = table.search(queryVector).limit(nResults);
            
            let metadataFilter = filter;
            if (filter?.metadata_filter) {
                metadataFilter = filter.metadata_filter;
            }

            if (metadataFilter && Object.keys(metadataFilter).length > 0) {
                const filterParts: string[] = [];
                for (const [key, value] of Object.entries(metadataFilter)) {
                    if (key === 'metadata_filter') continue;

                    if (Array.isArray(value)) {
                        const vals = value.map(v => typeof v === 'string' ? `'${v}'` : v).join(', ');
                        filterParts.push(`${key} IN (${vals})`);
                    } else if (typeof value === 'string') {
                        filterParts.push(`${key} = '${value}'`);
                    } else if (value !== null && typeof value === 'object') {
                        console.warn(`[LanceDB] Unsupported nested filter for key: ${key}`, value);
                    } else {
                        filterParts.push(`${key} = ${value}`);
                    }
                }
                if (filterParts.length > 0) {
                    const filterStr = filterParts.join(' AND ');
                    searchBuilder = searchBuilder.where(filterStr);
                }
            }

            const results = await searchBuilder.toArray();

            return results.map((r: any) => ({
                id: r.id,
                score: 1 - (r._distance || 0),
                metadata: {
                    id: r.id,
                    name: r.name,
                    triad: r.triad,
                    domain: r.domain,
                    symbol_domain: r.symbol_domain,
                    symbol_tag: r.symbol_tag,
                    role: r.role,
                    macro: r.macro,
                    kind: r.kind
                },
                document: r.text
            }));
        } catch (e) {
            console.error("[LanceDB] Search failed", e);
            return [];
        }
    },

    async resetCollection(): Promise<boolean> {
        try {
            const conn = await getDb();
            const tableNames = await conn.tableNames();
            if (tableNames.includes(COLLECTION_NAME)) {
                await conn.dropTable(COLLECTION_NAME);
            }
            return true;
        } catch (e) {
            return false;
        }
    },

    async countCollection(): Promise<number> {
        try {
            const table = await getTable();
            if (!table) return 0;
            return await table.countRows();
        } catch (e) {
            return 0;
        }
    },

    async removeSymbol(symbolId: string): Promise<boolean> {
        return this.deleteSymbol(symbolId);
    },

    // Test utility
    __resetDb() {
        db = null;
    },

    async syncLanceDB(allSqlSymbols: SymbolDef[]): Promise<{ deleted: number, updated: number }> {
        const stats = { deleted: 0, updated: 0 };
        try {
            let table = await getTable();
            if (!table) {
                if (allSqlSymbols.length > 0) {
                    stats.updated = await this.indexBatch(allSqlSymbols);
                }
                return stats;
            }

            // 1. Identify and delete entries in LanceDB that are no longer in SQLite
            const sqlIds = new Set(allSqlSymbols.map(s => s.id));
            let lanceEntries: any[] = [];
            try {
                lanceEntries = await table.query().select(['id', 'updated_at']).toArray();
            } catch (queryErr: any) {
                // If query fails due to missing field, trigger full re-index via indexBatch (which handles reset)
                if (queryErr.message?.includes('updated_at') || queryErr.message?.includes('schema')) {
                    console.warn("[LanceDB] Schema mismatch detected during sync query. Triggering full re-index...");
                    stats.updated = await this.indexBatch(allSqlSymbols);
                    return stats;
                }
                throw queryErr;
            }
            const obsoleteIds = lanceEntries.filter(r => !sqlIds.has(r.id)).map(r => r.id);
            
            if (obsoleteIds.length > 0) {
                console.log(`[LanceDB] Found ${obsoleteIds.length} obsolete symbols in index. Examples:`, obsoleteIds.slice(0, 5));
                // Delete in chunks to avoid query length limits
                const CHUNK_SIZE = 50;
                for (let i = 0; i < obsoleteIds.length; i += CHUNK_SIZE) {
                    const chunk = obsoleteIds.slice(i, i + CHUNK_SIZE);
                    const idsStr = chunk.map(id => `'${id}'`).join(',');
                    await table.delete(`id IN (${idsStr})`);
                    stats.deleted += chunk.length;
                }
            }

            // 2. Identify missing or outdated entries
            const lanceIdMap = new Map(lanceEntries.map(r => [r.id, r.updated_at]));
            const symbolsToUpdate = allSqlSymbols.filter(s => {
                const lanceUpdate = lanceIdMap.get(s.id);
                if (!lanceUpdate) return true; // Missing
                
                // Compare timestamps - use Date objects for safety across formats
                try {
                    const sqlTime = new Date(s.updated_at).getTime();
                    const lanceTime = new Date(lanceUpdate).getTime();
                    return sqlTime > lanceTime;
                } catch (e) {
                    return true; // If comparison fails, assume outdated
                }
            });
            
            if (symbolsToUpdate.length > 0) {
                stats.updated = await this.indexBatch(symbolsToUpdate);
            }

            return stats;
        } catch (e) {
            console.error("[LanceDB] Sync failed", e);
            return stats;
        }
    },

    // --- Monitoring Deltas Support ---

    async indexDeltaBatch(deltas: any[]): Promise<number> {
        if (deltas.length === 0) return 0;

        const allRecords: any[] = [];
        const EMBED_CHUNK_SIZE = 10;

        try {
            for (let i = 0; i < deltas.length; i += EMBED_CHUNK_SIZE) {
                const chunk = deltas.slice(i, i + EMBED_CHUNK_SIZE);
                const contents = chunk.map(d => `Source: ${d.sourceId}\nPeriod: ${d.period}\nContent: ${d.content}`);
                const vectors = await embedTexts(contents);
                
                for (let j = 0; j < chunk.length; j++) {
                    const delta = chunk[j];
                    allRecords.push({
                        vector: vectors[j],
                        id: delta.id,
                        text: contents[j],
                        sourceId: delta.sourceId,
                        period: delta.period,
                        timestamp: delta.timestamp,
                        metadata: JSON.stringify(delta.metadata || {})
                    });
                }
            }

            const conn = await getDb();
            let table = await getDeltasTable();

            if (!table) {
                await conn.createTable(DELTAS_COLLECTION_NAME, allRecords);
            } else {
                const ids = deltas.map(d => `'${d.id}'`).join(',');
                await table.delete(`id IN (${ids})`);
                await table.add(allRecords);
            }

            return deltas.length;
        } catch (e) {
            console.error("[LanceDB] Delta indexing error", e);
            return 0;
        }
    },

    async searchDeltas(query: string, nResults: number = 5, filter?: { sourceId?: string, period?: string }): Promise<VectorSearchResult[]> {
        try {
            const table = await getDeltasTable();
            if (!table) return [];

            const [queryVector] = await embedTexts([query]);
            let searchBuilder = table.search(queryVector).limit(nResults);

            if (filter) {
                const filterParts: string[] = [];
                if (filter.sourceId) filterParts.push(`sourceId = '${filter.sourceId}'`);
                if (filter.period) filterParts.push(`period = '${filter.period}'`);
                
                if (filterParts.length > 0) {
                    searchBuilder = searchBuilder.where(filterParts.join(' AND '));
                }
            }

            const results = await searchBuilder.toArray();

            return results.map((r: any) => ({
                id: r.id,
                score: 1 - (r._distance || 0),
                metadata: {
                    id: r.id,
                    sourceId: r.sourceId,
                    period: r.period,
                    timestamp: r.timestamp,
                    metadata: r.metadata ? JSON.parse(r.metadata) : {}
                },
                document: r.text
            }));
        } catch (e) {
            console.error("[LanceDB] Delta search failed", e);
            return [];
        }
    },

    async deleteDelta(deltaId: string): Promise<boolean> {
        try {
            const table = await getDeltasTable();
            if (table) {
                await table.delete(`id = '${deltaId}'`);
            }
            return true;
        } catch (e) {
            return false;
        }
    }
};
