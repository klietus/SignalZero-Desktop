import { describe, it, expect, vi, beforeEach } from 'vitest';
import { lancedbService } from '../services/lancedbService.js';
import * as embeddingService from '../services/embeddingService.js';
import * as lancedb from '@lancedb/lancedb';

vi.mock('../services/embeddingService.js', () => ({
    embedTexts: vi.fn()
}));

vi.mock('@lancedb/lancedb', () => ({
    connect: vi.fn(),
}));

describe('lancedbService Search Filters', () => {
    let mockTable: any;
    let mockSearchBuilder: any;

    beforeEach(() => {
        vi.clearAllMocks();
        lancedbService.__resetDb();

        mockSearchBuilder = {
            limit: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            toArray: vi.fn().mockResolvedValue([])
        };

        mockTable = {
            search: vi.fn().mockReturnValue(mockSearchBuilder)
        };

        const mockConn = {
            tableNames: vi.fn().mockResolvedValue(['symbols']),
            openTable: vi.fn().mockResolvedValue(mockTable)
        };

        (lancedb.connect as any).mockResolvedValue(mockConn);
        (embeddingService.embedTexts as any).mockResolvedValue([[0.1, 0.2, 0.3]]);
    });

    it('should correctly handle nested metadata_filter', async () => {
        const filter = {
            metadata_filter: {
                symbol_domain: ['user', 'state'],
                kind: 'pattern'
            }
        };

        await lancedbService.search('test query', 5, filter);

        const whereSpy = mockSearchBuilder.where;
        expect(whereSpy).toHaveBeenCalled();
        const call = whereSpy.mock.calls[0][0];
        expect(call).toContain("symbol_domain IN ('user', 'state')");
        expect(call).toContain("kind = 'pattern'");
    });

    it('should correctly handle flat filter as metadata_filter', async () => {
        const filter = {
            symbol_domain: ['user'],
            kind: 'data'
        };

        await lancedbService.search('test query', 5, filter);

        const whereSpy = mockSearchBuilder.where;
        expect(whereSpy).toHaveBeenCalled();
        const call = whereSpy.mock.calls[0][0];
        expect(call).toContain("symbol_domain IN ('user')");
        expect(call).toContain("kind = 'data'");
    });

    it('should handle numeric and string values in filters', async () => {
        const filter = {
            version: 1,
            status: 'active'
        };

        await lancedbService.search('test query', 5, filter);

        const whereSpy = mockSearchBuilder.where;
        expect(whereSpy).toHaveBeenCalled();
        const call = whereSpy.mock.calls[0][0];
        expect(call).toBe("version = 1 AND status = 'active'");
    });
});
