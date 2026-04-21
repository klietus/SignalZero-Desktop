import { describe, it, expect, vi, beforeEach } from 'vitest';
import { monitoringService } from '../services/monitoringService.js';
import { webFetchService } from '../services/webFetchService.js';
import { documentMeaningService } from '../services/documentMeaningService.js';
import { sqliteService } from '../services/sqliteService.js';

// Mock dependencies
vi.mock('../services/webFetchService.js', () => ({
    webFetchService: {
        fetch: vi.fn()
    }
}));

vi.mock('../services/settingsService.js', () => ({
    settingsService: {
        getInferenceSettings: vi.fn().mockResolvedValue({
            agentModel: 'gemini-1.5-pro',
            provider: 'gemini'
        }),
        getMonitoringSettings: vi.fn().mockResolvedValue({
            enabled: true,
            sources: []
        })
    }
}));

vi.mock('../services/inferenceService.js', () => {
    const mockGenerateContent = vi.fn().mockResolvedValue({
        response: { text: () => "Mocked delta summary" }
    });

    const mockGetGenerativeModel = vi.fn().mockReturnValue({
        generateContent: mockGenerateContent
    });

    return {
        getGeminiClient: vi.fn().mockResolvedValue({
            getGenerativeModel: mockGetGenerativeModel
        }),
        getClient: vi.fn(),
        extractJson: vi.fn(text => JSON.parse(text))
    };
});

vi.mock('../services/loggerService.js', () => ({
    loggerService: {
        catInfo: vi.fn(),
        catWarn: vi.fn(),
        catError: vi.fn(),
        catDebug: vi.fn(),
    },
    LogCategory: {
        MONITORING: 'MONITORING'
    }
}));

vi.mock('../services/sqliteService.js', () => ({
    sqliteService: {
        get: vi.fn(),
        all: vi.fn(),
        run: vi.fn()
    }
}));

vi.mock('../services/lancedbService.js', () => ({
    lancedbService: {
        indexDeltaBatch: vi.fn()
    }
}));

vi.mock('../services/eventBusService.js', () => ({
    eventBusService: {
        emitKernelEvent: vi.fn()
    }
}));

vi.mock('../services/documentMeaningService.js', () => ({
    documentMeaningService: {
        parse: vi.fn()
    }
}));

describe('MonitoringService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('summarizeArticle', () => {
        it('should use webFetchService when a link is present', async () => {
            const source = {
                id: 'test-rss',
                name: 'Test RSS',
                enabled: true,
                url: 'http://example.com/rss',
                pollingIntervalMs: 60000,
                type: 'rss' as const
            };
            const item = {
                title: 'Test Article',
                link: 'http://example.com/article'
            };

            const mockFetchResult = {
                url: 'http://example.com/article',
                title: 'Fetched Title',
                content: 'Full content from web fetch',
                excerpt: 'Snippet',
                extracted: {
                    imageUrl: 'http://example.com/image.jpg',
                    imageDescription: 'A beautiful sunset',
                    summary: 'Fetched summary'
                }
            };

            (webFetchService.fetch as any).mockResolvedValue(mockFetchResult);

            const result = await (monitoringService as any).summarizeArticle(source, item);

            expect(webFetchService.fetch).toHaveBeenCalledWith('http://example.com/article');
            expect(result.summary).toBe('Mocked delta summary');
            expect(result.imageUrl).toBe('http://example.com/image.jpg');
            expect(result.imageDescription).toBe('A beautiful sunset');
        });

        it('should fall back to item image and manual description if fetch fails', async () => {
             const source = {
                id: 'test-rss',
                name: 'Test RSS',
                enabled: true,
                url: 'http://example.com/rss',
                pollingIntervalMs: 60000,
                type: 'rss' as const
            };
            const item = {
                title: 'Test Article',
                link: 'http://example.com/article',
                image: 'http://example.com/item-image.jpg'
            };

            (webFetchService.fetch as any).mockResolvedValue(null);
            
            // Mock manual image description using vi.stubGlobal
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
                headers: { get: (name: string) => name === 'content-type' ? 'image/jpeg' : null }
            });
            const originalFetch = global.fetch;
            global.fetch = mockFetch;

            (documentMeaningService.parse as any).mockResolvedValue({
                type: 'image',
                content: 'Description from item image'
            });

            const result = await (monitoringService as any).summarizeArticle(source, item);

            expect(mockFetch).toHaveBeenCalled();
            expect(result.imageUrl).toBe('http://example.com/item-image.jpg');
            expect(result.imageDescription).toBe('Description from item image');
            
            global.fetch = originalFetch;
        });
    });

    describe('regenerateDelta', () => {
        it('should use webFetchService if articleUrl is in metadata', async () => {
            const mockDelta = {
                id: 'delta-123',
                source_id: 'test-source',
                period: 'hour',
                content: 'Old summary',
                timestamp: new Date().toISOString(),
                metadata: JSON.stringify({
                    articleUrl: 'http://example.com/article',
                    imageUrl: 'http://example.com/old-image.jpg'
                })
            };

            (sqliteService.get as any).mockReturnValue(mockDelta);

            const mockFetchResult = {
                url: 'http://example.com/article',
                title: 'New Fetched Title',
                content: 'Fresh content for regeneration',
                excerpt: 'New excerpt',
                extracted: {
                    imageUrl: 'http://example.com/new-image.jpg',
                    imageDescription: 'A newly described scene',
                    summary: 'New summary'
                }
            };

            (webFetchService.fetch as any).mockResolvedValue(mockFetchResult);

            const result = await monitoringService.regenerateDelta('delta-123');

            expect(webFetchService.fetch).toHaveBeenCalledWith('http://example.com/article');
            expect(sqliteService.run).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE monitoring_deltas'),
                expect.arrayContaining([
                    'Mocked delta summary',
                    expect.stringContaining('http://example.com/new-image.jpg'),
                    'delta-123'
                ])
            );
            expect(result?.content).toBe('Mocked delta summary');
            expect(result?.metadata!.imageUrl).toBe('http://example.com/new-image.jpg');
            expect(result?.metadata!.imageSummary).toBe('A newly described scene');
        });
    });

    describe('performRollup', () => {
        it('should propagate metadata from constituents to the synthesized rollup', async () => {
            const constituents = [
                {
                    timestamp: '2026-04-13T10:00:00Z',
                    content: 'Event A',
                    metadata: JSON.stringify({
                        articleUrl: 'http://example.com/a',
                        imageUrl: 'http://example.com/a.jpg',
                        imageSummary: 'Summary A'
                    })
                },
                {
                    timestamp: '2026-04-13T11:00:00Z',
                    content: 'Event B',
                    metadata: JSON.stringify({
                        articleUrl: 'http://example.com/b',
                        imageUrl: 'http://example.com/b.jpg',
                        imageSummary: 'Summary B'
                    })
                }
            ];

            const mockRollupResponse = {
                content: '# KEY THEMES\n- Trend 1\n\n# DETAILED LOG\n- Event A\n- Event B',
                featuredEvent: {
                    articleUrl: 'http://example.com/b',
                    imageUrl: 'http://example.com/b.jpg',
                    imageSummary: 'Summary B'
                }
            };

            const { getGeminiClient } = await import('../services/inferenceService.js');
            const client: any = await getGeminiClient();
            const mockGenerateContent = client.getGenerativeModel().generateContent;

            (mockGenerateContent as any).mockResolvedValueOnce({
                response: { text: () => JSON.stringify(mockRollupResponse) }
            });

            await (monitoringService as any).performRollup('test-source', 'hour', 'day', constituents);

            expect(sqliteService.run).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO monitoring_deltas'),
                expect.arrayContaining([
                    expect.stringContaining('# KEY THEMES'),
                    expect.stringContaining('http://example.com/b.jpg')
                ])
            );
        });
    });
});
