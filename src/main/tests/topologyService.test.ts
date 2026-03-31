import { describe, it, expect, vi, beforeEach } from 'vitest';
import { topologyService } from '../services/topologyService.js';
import { domainService } from '../services/domainService.js';
import { embedTexts } from '../services/embeddingService.js';

vi.mock('../services/domainService.js', () => ({
    domainService: {
        listDomains: vi.fn(),
        getSymbols: vi.fn(),
        mergeSymbols: vi.fn(),
        addSymbol: vi.fn()
    }
}));

vi.mock('../services/embeddingService.js', () => ({
    embedTexts: vi.fn()
}));

vi.mock('../services/settingsService.js', () => ({
    settingsService: {
        getHygieneSettings: vi.fn().mockResolvedValue({
            positional: { autoCompress: false, autoLink: false },
            semantic: { autoCompress: true, autoLink: true },
            triadic: { autoCompress: false, autoLink: false },
            deadLinkCleanup: false,
            orphanAnalysis: false
        }),
        getInferenceSettings: vi.fn().mockResolvedValue({ fastModel: 'test-model' })
    }
}));

vi.mock('../services/loggerService.js', () => ({
    loggerService: {
        catInfo: vi.fn(),
        catWarn: vi.fn(),
        catError: vi.fn(),
        catDebug: vi.fn()
    },
    LogCategory: {
        KERNEL: 'KERNEL',
        SYSTEM: 'SYSTEM'
    }
}));

vi.mock('../services/tentativeLinkService.js', () => ({
    tentativeLinkService: {
        processTrace: vi.fn().mockResolvedValue(undefined)
    }
}));

vi.mock('../services/eventBusService.js', () => ({
    eventBusService: {
        emitKernelEvent: vi.fn()
    },
    KernelEventType: {
        SYMBOL_COMPRESSION: 'SYMBOL_COMPRESSION'
    }
}));

describe('TopologyService Semantic Analysis', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should handle large number of symbols without crashing', async () => {
        const symbolCount = 100; // Testing with 100 for speed, but the logic is the same
        const symbols = Array.from({ length: symbolCount }, (_, i) => ({
            id: `SYM-${i}`,
            name: `Symbol ${i}`,
            role: `Role ${i}`,
            symbol_domain: 'test-domain',
            linked_patterns: []
        }));

        (domainService.listDomains as any).mockResolvedValue(['test-domain']);
        (domainService.getSymbols as any).mockResolvedValue(symbols);
        
        // Mock embeddings: half the symbols are same, half are different
        const mockEmbeddings = symbols.map((_, i) => {
            const vec = new Array(384).fill(0);
            vec[i % 2] = 1; // Alternating 1s to create clusters
            return vec;
        });
        (embedTexts as any).mockResolvedValue(mockEmbeddings);

        // Mock validation to always return true for simplicity
        // We need to mock validateLink which is private, but we can mock the inference calls it makes
        // Actually, let's just let it run.

        const stats = await topologyService.analyze('semantic');
        
        expect(stats).toBeDefined();
        expect(stats?.symbolCount).toBe(symbolCount);
        expect(embedTexts).toHaveBeenCalled();
    }, 30000);

    it('should recover if embedding fails', async () => {
        const symbols = [
            { id: 'S1', name: 'S1', role: 'R1', symbol_domain: 'D1' },
            { id: 'S2', name: 'S2', role: 'R2', symbol_domain: 'D1' }
        ];
        (domainService.listDomains as any).mockResolvedValue(['D1']);
        (domainService.getSymbols as any).mockResolvedValue(symbols);
        (embedTexts as any).mockRejectedValue(new Error('GPU Out of Memory'));

        const stats = await topologyService.analyze('semantic');
        
        expect(stats).toBeDefined();
        expect(stats?.newLinksPredicted).toBe(0);
        expect(stats?.redundantSymbolsFound).toBe(0);
    });
});
