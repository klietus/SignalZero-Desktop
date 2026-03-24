import { sqliteService } from './sqliteService.js';
import { loggerService } from './loggerService.js';
import { SymbolDef } from '../types.js';
import { eventBusService, KernelEventType } from './eventBusService.js';

export interface CacheEntry {
    symbol: SymbolDef;
    turnCount: number;
    lastUsed: number;
}

export class SymbolCacheService {
    private readonly CACHE_PREFIX = 'sz:symbol_cache:';
    private readonly MAX_TURNS = 5;

    private getCacheKey(sessionId: string): string {
        return `${this.CACHE_PREFIX}${sessionId}`;
    }

    async getSymbols(sessionId: string): Promise<SymbolDef[]> {
        const key = this.getCacheKey(sessionId);
        const data = await sqliteService.request(['GET', key]);
        if (!data) return [];

        const cache: Record<string, CacheEntry> = JSON.parse(data);
        const entries = Object.values(cache);
        entries.sort((a, b) => a.symbol.id.localeCompare(b.symbol.id));
        return entries.map(e => e.symbol);
    }

    async getPartitionedSymbols(sessionId: string): Promise<{ mature: SymbolDef[], newSymbols: SymbolDef[] }> {
        const key = this.getCacheKey(sessionId);
        const data = await sqliteService.request(['GET', key]);
        if (!data) return { mature: [], newSymbols: [] };

        const cache: Record<string, CacheEntry> = JSON.parse(data);
        const entries = Object.values(cache);

        const matureEntries = entries.filter(e => e.turnCount > 3);
        const newEntries = entries.filter(e => e.turnCount <= 3);

        matureEntries.sort((a, b) => a.symbol.id.localeCompare(b.symbol.id));
        newEntries.sort((a, b) => a.symbol.id.localeCompare(b.symbol.id));

        return {
            mature: matureEntries.map(e => e.symbol),
            newSymbols: newEntries.map(e => e.symbol)
        };
    }

    async upsertSymbol(sessionId: string, symbol: SymbolDef): Promise<void> {
        if (!sessionId) return;
        const key = this.getCacheKey(sessionId);
        const data = await sqliteService.request(['GET', key]);
        const cache: Record<string, CacheEntry> = data ? JSON.parse(data) : {};

        cache[symbol.id] = {
            symbol,
            turnCount: 0,
            lastUsed: Date.now()
        };

        await sqliteService.request(['SET', key, JSON.stringify(cache)]);
    }

    async batchUpsertSymbols(sessionId: string, symbols: SymbolDef[], initialTurnCount: number = 0): Promise<void> {
        if (!sessionId || symbols.length === 0) return;

        const key = this.getCacheKey(sessionId);
        const data = await sqliteService.request(['GET', key]);
        const cache: Record<string, CacheEntry> = data ? JSON.parse(data) : {};

        const now = Date.now();
        for (const symbol of symbols) {
            if (cache[symbol.id]) {
                cache[symbol.id] = {
                    ...cache[symbol.id],
                    symbol,
                    lastUsed: now
                };
            } else {
                cache[symbol.id] = {
                    symbol,
                    turnCount: initialTurnCount,
                    lastUsed: now
                };
            }
        }

        await sqliteService.request(['SET', key, JSON.stringify(cache)]);
    }

    async emitCacheLoad(sessionId: string): Promise<void> {
        const key = this.getCacheKey(sessionId);
        const data = await sqliteService.request(['GET', key]);
        if (!data) return;

        const cache: Record<string, CacheEntry> = JSON.parse(data);
        const entries = Object.values(cache);

        entries.sort((a, b) => {
            if (a.turnCount !== b.turnCount) return a.turnCount - b.turnCount;
            return b.lastUsed - a.lastUsed;
        });

        const symbols = entries.map(e => e.symbol);
        eventBusService.emitKernelEvent(KernelEventType.CACHE_LOAD, {
            sessionId,
            symbolIds: symbols.map(s => s.id),
            symbols: symbols
        });
    }

    async touchSymbol(sessionId: string, symbolId: string): Promise<void> {
        if (!sessionId) return;
        const key = this.getCacheKey(sessionId);
        const data = await sqliteService.request(['GET', key]);
        if (!data) return;

        const cache: Record<string, CacheEntry> = JSON.parse(data);
        if (cache[symbolId]) {
            cache[symbolId].turnCount = 0;
            cache[symbolId].lastUsed = Date.now();
            await sqliteService.request(['SET', key, JSON.stringify(cache)]);
        }
    }

    async incrementTurns(sessionId: string): Promise<void> {
        if (!sessionId) return;
        const key = this.getCacheKey(sessionId);
        const data = await sqliteService.request(['GET', key]);
        if (!data) return;

        const cache: Record<string, CacheEntry> = JSON.parse(data);
        const newCache: Record<string, CacheEntry> = {};
        const evictedIds: string[] = [];

        for (const [id, entry] of Object.entries(cache)) {
            const newTurnCount = entry.turnCount + 1;
            if (newTurnCount < this.MAX_TURNS) {
                newCache[id] = { ...entry, turnCount: newTurnCount };
            } else {
                evictedIds.push(id);
            }
        }

        if (Object.keys(newCache).length > 0) {
            await sqliteService.request(['SET', key, JSON.stringify(newCache)]);
        } else {
            await sqliteService.request(['DEL', key]);
        }
    }

    async clearCache(sessionId: string): Promise<void> {
        const key = this.getCacheKey(sessionId);
        await sqliteService.request(['DEL', key]);
    }
}

export const symbolCacheService = new SymbolCacheService();
