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
        const content = `
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

        try {
            const [vector] = await embedTexts([content]);
            const conn = await getDb();
            const table = await getTable();

            const record = {
                vector,
                id: symbol.id,
                text: content,
                name: symbol.name,
                triad: symbol.triad,
                domain: symbol.symbol_domain,
                symbol_domain: symbol.symbol_domain,
                symbol_tag: symbol.symbol_tag,
                role: symbol.role,
                macro: symbol.macro,
                kind: symbol.kind || 'pattern'
            };

            if (!table) {
                await conn.createTable(COLLECTION_NAME, [record]);
            } else {
                // LanceDB doesn't have a direct upsert by ID in the same way Chroma does
                // We typically delete and add, or use a merge if supported by the version
                await table.delete(`id = '${symbol.id}'`);
                await table.add([record]);
            }

            return true;
        } catch (e) {
            console.error("[LanceDB] Indexing error", e);
            return false;
        }
    },

    async indexBatch(symbols: SymbolDef[]): Promise<number> {
        if (symbols.length === 0) return 0;
        let successCount = 0;
        for (const sym of symbols) {
            if (await this.indexSymbol(sym)) successCount++;
        }
        return successCount;
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

    async search(query: string, nResults: number = 5, metadataFilter?: Record<string, any>): Promise<VectorSearchResult[]> {
        try {
            const table = await getTable();
            if (!table) return [];

            const [queryVector] = await embedTexts([query]);
            
            let searchBuilder = table.search(queryVector).limit(nResults);
            
            // Apply filtering if metadataFilter is provided
            if (metadataFilter) {
                const filterParts: string[] = [];
                for (const [key, value] of Object.entries(metadataFilter)) {
                    if (Array.isArray(value)) {
                        const vals = value.map(v => typeof v === 'string' ? `'${v}'` : v).join(', ');
                        filterParts.push(`${key} IN (${vals})`);
                    } else if (typeof value === 'string') {
                        filterParts.push(`${key} = '${value}'`);
                    } else {
                        filterParts.push(`${key} = ${value}`);
                    }
                }
                if (filterParts.length > 0) {
                    searchBuilder = searchBuilder.where(filterParts.join(' AND '));
                }
            }

            const results = await searchBuilder.execute();

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
    }
};
