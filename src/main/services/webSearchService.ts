import { settingsService } from "./settingsService.js";
import { loggerService, LogCategory } from "./loggerService.js";

export interface WebSearchResult {
  title: string;
  link: string;
  snippet: string;
}

export const webSearchService = {
  search: async (query: string): Promise<{ results: WebSearchResult[], provider: string }> => {
    loggerService.catInfo(LogCategory.TOOL, `[WebSearch] Starting search for: "${query}"`);

    const serpSettings = await settingsService.getSerpApiSettings();
    const braveSettings = await settingsService.getBraveSearchSettings();
    const tavilySettings = await settingsService.getTavilySettings();

    const providers = [
      { 
        name: 'serpApi', 
        settings: serpSettings, 
        search: async (q: string, key: string) => {
          const url = `https://serpapi.com/search?q=${encodeURIComponent(q)}&api_key=${key}&engine=google`;
          loggerService.catDebug(LogCategory.TOOL, `[SerpApi] Fetching: ${url.replace(key, '***')}`);
          const resp = await fetch(url);
          const data = await resp.json();
          if (!resp.ok) {
            loggerService.catError(LogCategory.TOOL, `[SerpApi] Error response`, { status: resp.status, data });
            throw new Error(`SerpApi failed: ${resp.status} ${data.error || resp.statusText}`);
          }
          const results = (data.organic_results || []).map((r: any) => ({ 
            title: r.title, 
            link: r.link, 
            snippet: r.snippet 
          }));
          loggerService.catDebug(LogCategory.TOOL, `[SerpApi] Found ${results.length} results`);
          return results;
        }
      },
      { 
        name: 'brave', 
        settings: braveSettings, 
        search: async (q: string, key: string) => {
          const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}`;
          loggerService.catDebug(LogCategory.TOOL, `[Brave] Fetching: ${url}`);
          const resp = await fetch(url, { headers: { 'Accept': 'application/json', 'X-Subscription-Token': key } });
          const data = await resp.json();
          if (!resp.ok) {
            loggerService.catError(LogCategory.TOOL, `[Brave] Error response`, { status: resp.status, data });
            throw new Error(`Brave Search failed: ${resp.status} ${data.message || resp.statusText}`);
          }
          const results = (data.web?.results || []).map((r: any) => ({ 
            title: r.title, 
            link: r.url, 
            snippet: r.description 
          }));
          loggerService.catDebug(LogCategory.TOOL, `[Brave] Found ${results.length} results`);
          return results;
        }
      },
      { 
        name: 'tavily', 
        settings: tavilySettings, 
        search: async (q: string, key: string) => {
          loggerService.catDebug(LogCategory.TOOL, `[Tavily] Posting search for: "${q}"`);
          const resp = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: key, query: q, search_depth: 'basic' })
          });
          const data = await resp.json();
          if (!resp.ok) {
            loggerService.catError(LogCategory.TOOL, `[Tavily] Error response`, { status: resp.status, data });
            throw new Error(`Tavily failed: ${resp.status} ${data.detail || resp.statusText}`);
          }
          const results = (data.results || []).map((r: any) => ({ 
            title: r.title, 
            link: r.url, 
            snippet: r.content 
          }));
          loggerService.catDebug(LogCategory.TOOL, `[Tavily] Found ${results.length} results`);
          return results;
        }
      }
    ];

    let lastError = null;
    for (const provider of providers) {
      const isEnabled = provider.settings.enabled;
      const hasKey = !!provider.settings.apiKey;

      if (!isEnabled || !hasKey) {
        loggerService.catDebug(LogCategory.TOOL, `[WebSearch] Skipping ${provider.name}`, { isEnabled, hasKey });
        continue;
      }

      try {
        loggerService.catInfo(LogCategory.TOOL, `[WebSearch] Trying ${provider.name}...`);
        const results = await provider.search(query, provider.settings.apiKey);
        loggerService.catInfo(LogCategory.TOOL, `[WebSearch] ${provider.name} success`, { count: results.length });
        return { results, provider: provider.name };
      } catch (e: any) {
        loggerService.catError(LogCategory.TOOL, `[WebSearch] ${provider.name} failed`, { error: e.message });
        lastError = e.message;
      }
    }

    const finalError = lastError || "No web search providers enabled or configured.";
    loggerService.catError(LogCategory.TOOL, `[WebSearch] All providers failed or were skipped.`, { error: finalError });
    throw new Error(finalError);
  }
};
