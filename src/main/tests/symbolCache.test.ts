import { describe, it, expect, beforeEach } from 'vitest';
import { symbolCacheService } from '../services/symbolCacheService.js';
import { sqliteService } from '../services/sqliteService.js';
import { SymbolDef } from '../types.js';

const MOCK_SYMBOL: SymbolDef = {
    id: 'S1',
    name: 'Sym 1',
    kind: 'pattern',
    triad: 'A,B,C',
    macro: 'Macro 1',
    role: 'Role 1',
    symbol_domain: 'dom1',
    symbol_tag: 'tag1',
    failure_mode: 'none',
    activation_conditions: [],
    linked_patterns: [],
    facets: { function: 'f1' } as any,
    created_at: '2026-03-10T00:00:00Z',
    updated_at: '2026-03-10T00:00:00Z'
};

describe('SymbolCache Service Relational', () => {
    beforeEach(() => {
        sqliteService.__sqliteTestUtils.reset();
    });

    it('should upsert and retrieve symbols from cache', async () => {
        await symbolCacheService.upsertSymbol('sess-1', MOCK_SYMBOL);
        const symbols = await symbolCacheService.getSymbols('sess-1');
        expect(symbols).toHaveLength(1);
        expect(symbols[0].id).toBe('S1');
    });

    it('should evict after 5 turns', async () => {
        await symbolCacheService.upsertSymbol('sess-1', MOCK_SYMBOL);
        
        for (let i = 0; i < 5; i++) {
            await symbolCacheService.incrementTurns('sess-1');
        }

        const symbols = await symbolCacheService.getSymbols('sess-1');
        expect(symbols).toHaveLength(0);
    });

    it('should keep symbols when touched', async () => {
        await symbolCacheService.upsertSymbol('sess-1', MOCK_SYMBOL);
        await symbolCacheService.incrementTurns('sess-1');
        await symbolCacheService.incrementTurns('sess-1');
        
        await symbolCacheService.touchSymbol('sess-1', 'S1');
        
        for (let i = 0; i < 3; i++) {
            await symbolCacheService.incrementTurns('sess-1');
        }
        
        const symbols = await symbolCacheService.getSymbols('sess-1');
        expect(symbols).toHaveLength(1); 
    });
});
