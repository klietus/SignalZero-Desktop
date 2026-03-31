import { settingsService } from "./settingsService.js";
import { loggerService } from "./loggerService.js";

export interface WebSearchResult {
  title: string;
  link: string;
  snippet: string;
}

export const webSearchService = {
  search: async (query: string): Promise<{ results: WebSearchResult[], provider: string }> => {
    const serpSettings = await settingsService.getSerpApiSettings();
    const braveSettings = await settingsService.getBraveSearchSettings();
    const tavilySettings = await settingsService.getTavilySettings();

    const providers = [
      { 
        name: 'serpApi', 
        settings: serpSettings, 
        search: async (q: string, key: string) => {
          const url = `https://serpapi.com/search?q=${encodeURIComponent(q)}&api_key=${key}&engine=google`;
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`SerpApi failed: ${resp.statusText}`);
          const data = await resp.json();
          return (data.organic_results || []).map((r: any) => ({ 
            title: r.title, 
            link: r.link, 
            snippet: r.snippet 
          }));
        }
      },
      { 
        name: 'brave', 
        settings: braveSettings, 
        search: async (q: string, key: string) => {
          const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}`;
          const resp = await fetch(url, { headers: { 'X-Subscription-Token': key } });
          if (!resp.ok) throw new Error(`Brave Search failed: ${resp.statusText}`);
          const data = await resp.json();
          return (data.web?.results || []).map((r: any) => ({ 
            title: r.title, 
            link: r.url, 
            snippet: r.description 
          }));
        }
      },
      { 
        name: 'tavily', 
        settings: tavilySettings, 
        search: async (q: string, key: string) => {
          const resp = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: key, query: q, search_depth: 'basic' })
          });
          if (!resp.ok) throw new Error(`Tavily failed: ${resp.statusText}`);
          const data = await resp.json();
          return (data.results || []).map((r: any) => ({ 
            title: r.title, 
            link: r.url, 
            snippet: r.content 
          }));
        }
      }
    ];

    let lastError = null;
    for (const provider of providers) {
      if (provider.settings.enabled && provider.settings.apiKey) {
        try {
          loggerService.info(`[WebSearch] Trying ${provider.name}...`);
          const results = await provider.search(query, provider.settings.apiKey);
          return { results, provider: provider.name };
        } catch (e: any) {
          loggerService.error(`[WebSearch] ${provider.name} failed`, { error: e.message });
          lastError = e.message;
        }
      }
    }

    throw new Error(lastError || "No web search providers enabled or configured.");
  }
};
