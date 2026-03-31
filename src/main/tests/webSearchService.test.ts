import { describe, it, expect, vi, beforeEach } from 'vitest';
import { webSearchService } from '../services/webSearchService.js';
import { settingsService } from '../services/settingsService.js';

vi.mock('../services/settingsService.js', () => ({
  settingsService: {
    getSerpApiSettings: vi.fn(),
    getBraveSearchSettings: vi.fn(),
    getTavilySettings: vi.fn()
  }
}));

vi.mock('../services/loggerService.js', () => ({
  loggerService: {
    info: vi.fn(),
    error: vi.fn()
  }
}));

describe('webSearchService failover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('should failover from SerpApi to Brave if SerpApi fails', async () => {
    (settingsService.getSerpApiSettings as any).mockResolvedValue({ apiKey: 'serp-key', enabled: true });
    (settingsService.getBraveSearchSettings as any).mockResolvedValue({ apiKey: 'brave-key', enabled: true });
    (settingsService.getTavilySettings as any).mockResolvedValue({ apiKey: 'tavily-key', enabled: true });

    // Mock SerpApi failure
    (global.fetch as any)
      .mockResolvedValueOnce({ ok: false, statusText: 'Forbidden' }) // SerpApi
      .mockResolvedValueOnce({ 
        ok: true, 
        json: async () => ({ web: { results: [{ title: 'Brave Result', url: 'http://brave.com', description: 'desc' }] } }) 
      }); // Brave

    const result = await webSearchService.search('test query');
    expect(result.provider).toBe('brave');
    expect(result.results[0].title).toBe('Brave Result');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('should skip disabled providers', async () => {
    (settingsService.getSerpApiSettings as any).mockResolvedValue({ apiKey: 'serp-key', enabled: false });
    (settingsService.getBraveSearchSettings as any).mockResolvedValue({ apiKey: 'brave-key', enabled: true });
    (settingsService.getTavilySettings as any).mockResolvedValue({ apiKey: 'tavily-key', enabled: true });

    (global.fetch as any).mockResolvedValue({ 
      ok: true, 
      json: async () => ({ web: { results: [{ title: 'Brave Result', url: 'http://brave.com', description: 'desc' }] } }) 
    });

    const result = await webSearchService.search('test query');
    expect(result.provider).toBe('brave');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    // Should NOT have called SerpApi because it was disabled
    expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('serpapi.com'), expect.anything());
  });

  it('should throw error if all enabled providers fail', async () => {
    (settingsService.getSerpApiSettings as any).mockResolvedValue({ apiKey: 'serp-key', enabled: true });
    (settingsService.getBraveSearchSettings as any).mockResolvedValue({ apiKey: 'brave-key', enabled: false });
    (settingsService.getTavilySettings as any).mockResolvedValue({ apiKey: 'tavily-key', enabled: false });

    (global.fetch as any).mockResolvedValue({ ok: false, statusText: 'Service Unavailable' });

    await expect(webSearchService.search('test query')).rejects.toThrow('SerpApi failed: Service Unavailable');
  });
});
