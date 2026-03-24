import { describe, it, expect, beforeEach, vi } from 'vitest';
import { domainService } from '../services/domainService.js';
import { lancedbService } from '../services/lancedbService.js';
import { sqliteService } from '../services/sqliteService.js';

describe('DomainService Relational', () => {
    beforeEach(() => {
        sqliteService.__sqliteTestUtils.reset();

        // Mock vector service
        vi.spyOn(lancedbService, 'indexSymbol').mockResolvedValue(true);
        vi.spyOn(lancedbService, 'indexBatch').mockResolvedValue(0);
        vi.spyOn(lancedbService, 'deleteSymbol').mockResolvedValue(true);
    });

    it('should initialize domains and list them', async () => {
        await domainService.init('test-dom', 'Test');
        const domains = await domainService.listDomains();
        expect(domains).toContain('test-dom');
    });

    it('should add symbols and normalize links', async () => {
        await domainService.init('root', 'Root');
        
        // Target must exist due to foreign key
        await domainService.addSymbol('root', { id: 'S2', name: 'Symbol 2' } as any);

        const symbol: any = { 
            id: 'S1', 
            name: 'Symbol 1',
            linked_patterns: [
                { id: 'S2', link_type: 'depends_on', bidirectional: false }
            ]
        };
        
        await domainService.addSymbol('root', symbol);

        const retrieved = await domainService.findById('S1');
        expect(retrieved?.id).toBe('S1');
        expect(retrieved?.linked_patterns).toHaveLength(1);
        expect(retrieved?.linked_patterns[0].id).toBe('S2');
    });

    it('should handle domain metadata', async () => {
        await domainService.createDomain('custom', { name: 'Custom Name', description: 'Desc', invariants: ['Inv 1'] });
        const meta = await domainService.getMetadata();
        const custom = meta.find(m => m.id === 'custom');
        expect(custom.name).toBe('Custom Name');
        expect(custom.invariants).toContain('Inv 1');
    });
});
