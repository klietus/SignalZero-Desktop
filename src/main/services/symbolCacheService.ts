import { SymbolDef } from '../types.js';
import { eventBusService, KernelEventType } from './eventBusService.js';
import { loggerService, LogCategory } from './loggerService.js';

export interface CacheEntry {
    symbol: SymbolDef;
    turnCount: number;
    lastUsed: number;
}

/**
 * SymbolCacheService (In-Process ADT)
 * 
 * Manages the "working set" of symbols for active context sessions.
 * Symbols in the cache are part of the DYNAMIC_SYMBOLS block in the context window.
 * 
 * Logic:
 * - Symbols stay in cache for MAX_TURNS (default 5).
 * - Mature symbols (turnCount > 3) are stable.
 * - New symbols (turnCount <= 3) are volatile.
 * - Cache is purely in-memory (in-process) for the desktop app.
 */
export class SymbolCacheService {
    private readonly MAX_TURNS = 3;
    
    // Map of Session ID -> Map of Symbol ID -> CacheEntry
    private sessionCaches: Map<string, Map<string, CacheEntry>> = new Map();

    private getOrCreateSessionCache(sessionId: string): Map<string, CacheEntry> {
        let cache = this.sessionCaches.get(sessionId);
        if (!cache) {
            cache = new Map<string, CacheEntry>();
            this.sessionCaches.set(sessionId, cache);
        }
        return cache;
    }

    async getSymbols(sessionId: string): Promise<SymbolDef[]> {
        const cache = this.sessionCaches.get(sessionId);
        if (!cache) return [];

        const entries = Array.from(cache.values());
        entries.sort((a, b) => (a.symbol?.id || '').localeCompare(b.symbol?.id || ''));
        return entries.map(e => e.symbol);
    }

    async getPartitionedSymbols(sessionId: string): Promise<{ mature: SymbolDef[], newSymbols: SymbolDef[] }> {
        const cache = this.sessionCaches.get(sessionId);
        if (!cache) {
            loggerService.catDebug(LogCategory.KERNEL, `Cache empty for session ${sessionId}`);
            return { mature: [], newSymbols: [] };
        }

        const entries = Array.from(cache.values());
        loggerService.catDebug(LogCategory.KERNEL, `Partitioning ${entries.length} symbols for session ${sessionId}`);

        const matureEntries = entries.filter(e => e.turnCount >= 2);
        const newEntries = entries.filter(e => e.turnCount < 2);

        matureEntries.sort((a, b) => (a.symbol?.id || '').localeCompare(b.symbol?.id || ''));
        newEntries.sort((a, b) => (a.symbol?.id || '').localeCompare(b.symbol?.id || ''));

        return {
            mature: matureEntries.map(e => e.symbol),
            newSymbols: newEntries.map(e => e.symbol)
        };
    }

    async upsertSymbol(sessionId: string, symbol: SymbolDef): Promise<void> {
        if (!sessionId) return;
        const cache = this.getOrCreateSessionCache(sessionId);

        loggerService.catDebug(LogCategory.KERNEL, `Upserting symbol ${symbol.id} into cache for session ${sessionId}`);

        cache.set(symbol.id, {
            symbol,
            turnCount: 0,
            lastUsed: Date.now()
        });
    }

    async batchUpsertSymbols(sessionId: string, symbols: SymbolDef[], initialTurnCount: number = 0): Promise<{ added: number, updated: number }> {
        if (!sessionId || symbols.length === 0) return { added: 0, updated: 0 };

        const cache = this.sessionCaches.get(sessionId) || this.getOrCreateSessionCache(sessionId);
        const now = Date.now();
        let added = 0;
        let updated = 0;

        for (const symbol of symbols) {
            const existing = cache.get(symbol.id);
            if (existing) {
                cache.set(symbol.id, {
                    ...existing,
                    symbol,
                    lastUsed: now
                });
                updated++;
            } else {
                cache.set(symbol.id, {
                    symbol,
                    turnCount: initialTurnCount,
                    lastUsed: now
                });
                added++;
            }
        }

        loggerService.catInfo(LogCategory.KERNEL, `Caching: ${added} new symbols, ${updated} updated in session ${sessionId}`);
        return { added, updated };
    }

    async emitCacheLoad(sessionId: string): Promise<void> {
        const cache = this.sessionCaches.get(sessionId);
        if (!cache) return;

        const entries = Array.from(cache.values());

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
        const cache = this.sessionCaches.get(sessionId);
        if (!cache) return;

        const entry = cache.get(symbolId);
        if (entry) {
            entry.turnCount = 0;
            entry.lastUsed = Date.now();
        }
    }

    async incrementTurns(sessionId: string): Promise<void> {
        if (!sessionId) return;
        const cache = this.sessionCaches.get(sessionId);
        if (!cache) return;

        for (const [id, entry] of cache.entries()) {
            entry.turnCount += 1;
            if (entry.turnCount >= this.MAX_TURNS) {
                loggerService.catDebug(LogCategory.KERNEL, `Evicting symbol ${id} from cache for session ${sessionId}`);
                cache.delete(id);
                eventBusService.emitKernelEvent(KernelEventType.SYMBOL_DELETED, { 
                    symbolId: id,
                    sessionId,
                    isEviction: true
                });
            }
        }
    }

    async clearCache(sessionId: string): Promise<void> {
        this.sessionCaches.delete(sessionId);
    }
}

export const symbolCacheService = new SymbolCacheService();
