import { settingsService } from './settingsService.js';
import { loggerService, LogCategory } from './loggerService.js';
import { sqliteService } from './sqliteService.js';
import { lancedbService } from './lancedbService.js';
import { getClient, getGeminiClient, extractJson } from './inferenceService.js';
import { MonitoringSourceConfig, MonitoringDelta, MonitoringPeriod } from '../types.js';
import { randomUUID } from 'crypto';
import { AcledProvider } from './monitoring/providers/acled.js';
import { RssProvider } from './monitoring/providers/rss.js';
import { WebScrapeProvider } from './monitoring/providers/web.js';
import { ApiProvider } from './monitoring/providers/api.js';
import { GdeltProvider } from './monitoring/providers/gdelt.js';
import { AlphaVantageProvider } from './monitoring/providers/alphavantage.js';
import { MarketStackProvider } from './monitoring/providers/marketstack.js';
import { AviationStackProvider } from './monitoring/providers/aviationstack.js';
import { MarineTrafficProvider } from './monitoring/providers/marinetraffic.js';
import { NyTimesProvider } from './monitoring/providers/nytimes.js';
import { CnnProvider } from './monitoring/providers/cnn.js';
import { ReutersProvider } from './monitoring/providers/reuters.js';
import { AlJazeeraProvider } from './monitoring/providers/aljazeera.js';
import { MonitoringProvider } from './monitoring/types.js';

const PREBUILT_SOURCES: MonitoringSourceConfig[] = [
    { id: 'acled', name: 'ACLED (Conflict Data)', enabled: false, url: 'https://api.acleddata.com/api/acled/read?limit=10&terms_accept=yes', pollingIntervalMs: 86400000, type: 'api' },
    { id: 'gdelt', name: 'GDELT (Global Events)', enabled: false, url: 'https://api.gdeltproject.org/api/v2/doc/doc?query=world&mode=artlist&format=json&maxrecords=20', pollingIntervalMs: 3600000, timeoutMs: 120000, type: 'api' },
    { id: 'alphavantage', name: 'Alpha Vantage (Markets)', enabled: false, url: 'https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=SPY', pollingIntervalMs: 3600000, type: 'api' },
    { id: 'marketstack', name: 'Market Stack (Stocks)', enabled: false, url: 'http://api.marketstack.com/v1/eod?symbols=AAPL', pollingIntervalMs: 86400000, type: 'api' },
    { id: 'aviationstack', name: 'Aviation Stack (Flights)', enabled: false, url: 'http://api.aviationstack.com/v1/flights?limit=10', pollingIntervalMs: 3600000, type: 'api' },
    { id: 'marinetraffic', name: 'Marine Traffic', enabled: false, url: 'https://services.marinetraffic.com/api/exportvessels/v:8/protocol:json', pollingIntervalMs: 3600000, type: 'api' },
    { id: 'times-news', name: 'The New York Times', enabled: false, url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', pollingIntervalMs: 3600000, type: 'rss' },
    { id: 'cnn-news', name: 'CNN World', enabled: false, url: 'http://rss.cnn.com/rss/edition_world.rss', pollingIntervalMs: 3600000, type: 'rss' },
    { id: 'reuters-news', name: 'Reuters World News', enabled: false, url: 'https://www.reuters.com/world/', pollingIntervalMs: 3600000, type: 'web' },
    { id: 'aljazeera-news', name: 'Al Jazeera', enabled: false, url: 'https://www.aljazeera.com/xml/rss/all.xml', pollingIntervalMs: 3600000, type: 'rss' }
];

class MonitoringService {
    private intervals: Map<string, NodeJS.Timeout> = new Map();
    private providers: Map<string, MonitoringProvider> = new Map();
    private isRunning = false;

    constructor() {
        // Register Specialized Providers
        this.providers.set('acled', new AcledProvider());
        this.providers.set('gdelt', new GdeltProvider());
        this.providers.set('alphavantage', new AlphaVantageProvider());
        this.providers.set('marketstack', new MarketStackProvider());
        this.providers.set('aviationstack', new AviationStackProvider());
        this.providers.set('marinetraffic', new MarineTrafficProvider());
        this.providers.set('times-news', new NyTimesProvider());
        this.providers.set('cnn-news', new CnnProvider());
        this.providers.set('reuters-news', new ReutersProvider());
        this.providers.set('aljazeera-news', new AlJazeeraProvider());

        // Generic Type Fallbacks
        this.providers.set('rss', new RssProvider());
        this.providers.set('web', new WebScrapeProvider());
        this.providers.set('api', new ApiProvider());
    }

    async initialize() {
        if (this.isRunning) return;
        this.isRunning = true;
        
        loggerService.catInfo(LogCategory.MONITORING, "Initializing Monitoring Service");

        // Ensure prebuilt sources exist in settings and have updated URLs
        const settings = await settingsService.getMonitoringSettings();
        let changed = false;
        for (const prebuilt of PREBUILT_SOURCES) {
            const existing = settings.sources.find(s => s.id === prebuilt.id);
            if (!existing) {
                settings.sources.push(prebuilt);
                changed = true;
            } else {
                // If it's a prebuilt source and the URL has changed in our code, update it
                // but keep the user's enabled status and metadata
                if (existing.url !== prebuilt.url && !existing.id.startsWith('mon-')) {
                    loggerService.catInfo(LogCategory.MONITORING, `Updating URL for system source: ${existing.id}`);
                    existing.url = prebuilt.url;
                    changed = true;
                }
            }
        }
        if (changed) {
            await settingsService.setMonitoringSettings(settings);
        }

        await this.refreshIntervals();
        
        // Start the rollup checker (every 15 minutes)
        setInterval(() => this.checkRollups(), 15 * 60 * 1000);
    }

    async refreshIntervals() {
        const settings = await settingsService.getMonitoringSettings();
        
        // Stop removed or disabled sources
        for (const [id, interval] of this.intervals.entries()) {
            const config = settings.sources.find(s => s.id === id);
            if (!config || !config.enabled || !settings.enabled) {
                clearInterval(interval);
                this.intervals.delete(id);
                loggerService.catInfo(LogCategory.MONITORING, `Stopped monitoring source: ${id}`);
            }
        }

        if (!settings.enabled) return;

        // Start new or updated sources
        for (const source of settings.sources) {
            if (source.enabled && !this.intervals.has(source.id)) {
                const interval = setInterval(() => this.pollSource(source), source.pollingIntervalMs);
                this.intervals.set(source.id, interval);
                loggerService.catInfo(LogCategory.MONITORING, `Started monitoring source: ${source.name} (${source.id})`, { interval: source.pollingIntervalMs });
                
                // Initial poll
                this.pollSource(source);
            }
        }
    }

    async triggerPoll(sourceId: string) {
        const settings = await settingsService.getMonitoringSettings();
        const source = settings.sources.find(s => s.id === sourceId);
        if (source) {
            await this.pollSource(source);
        }
    }

    private async pollSource(source: MonitoringSourceConfig) {
        loggerService.catDebug(LogCategory.MONITORING, `Polling source: ${source.name}`);
        try {
            const provider = this.providers.get(source.id) || this.providers.get(source.type);
            if (!provider) {
                loggerService.catError(LogCategory.MONITORING, `No provider found for source: ${source.id} (type: ${source.type})`);
                return;
            }

            const rawData = await provider.poll(source);
            if (!rawData) return;

            // 1. Itemize the raw data into individual articles/entries
            const items = await this.itemizeData(source, rawData);
            
            if (items && items.length > 0) {
                loggerService.catInfo(LogCategory.MONITORING, `Source ${source.name} returned ${items.length} items. Checking cache...`);
                
                for (const item of items) {
                    const articleId = item.id || item.link || item.title;
                    if (!articleId) continue;

                    // 2. Check SQLite cache
                    const cached = sqliteService.get(
                        `SELECT summary FROM monitoring_article_cache WHERE source_id = ? AND article_id = ?`,
                        [source.id, articleId]
                    );

                    if (cached) {
                        loggerService.catDebug(LogCategory.MONITORING, `Skipping cached article: ${articleId}`);
                        continue;
                    }

                    // 3. Summarize new article
                    const summary = await this.summarizeArticle(source, item);
                    if (summary) {
                        // 4. Cache the result
                        sqliteService.run(
                            `INSERT INTO monitoring_article_cache (source_id, article_id, summary) VALUES (?, ?, ?)`,
                            [source.id, articleId, summary]
                        );

                        // 5. Feed to delta engine
                        await this.recordDelta(source.id, 'hour', summary);
                    }
                }
            } else {
                // Fallback for non-itemized or failed itemization
                const summary = await this.summarizeRawData(source, rawData);
                if (summary && summary.hasChanges) {
                    await this.recordDelta(source.id, 'hour', summary.content);
                }
            }

            // Update last polled
            const settings = await settingsService.getMonitoringSettings();
            const idx = settings.sources.findIndex(s => s.id === source.id);
            if (idx !== -1) {
                settings.sources[idx].lastPolledAt = new Date().toISOString();
                await settingsService.setMonitoringSettings(settings);
            }

        } catch (error) {
            loggerService.catError(LogCategory.MONITORING, `Failed to poll source: ${source.name}`, { error });
        }
    }

    private async itemizeData(source: MonitoringSourceConfig, rawData: string): Promise<any[] | null> {
        const settings = await settingsService.getInferenceSettings();
        const fastModel = settings.fastModel;
        if (!fastModel) return null;

        loggerService.catDebug(LogCategory.MONITORING, `Itemizing data for ${source.name} (type: ${source.type})`, { length: rawData.length });

        // Specialized itemization logic for common formats
        if (source.type === 'api') {
            try {
                const data = JSON.parse(rawData);
                // ACLED: { data: [...] }
                if (source.id === 'acled' && Array.isArray(data.data)) {
                    loggerService.catInfo(LogCategory.MONITORING, `Itemized ${data.data.length} items from ACLED API`);
                    return data.data;
                }
                // GDELT Artlist: { articles: [...] }
                if (source.id === 'gdelt' && Array.isArray(data.articles)) {
                    loggerService.catInfo(LogCategory.MONITORING, `Itemized ${data.articles.length} articles from GDELT API`);
                    return data.articles;
                }
                // Aviation Stack: { data: [...] }
                if (source.id.includes('stack') && Array.isArray(data.data)) {
                    loggerService.catInfo(LogCategory.MONITORING, `Itemized ${data.data.length} items from ${source.name}`);
                    return data.data;
                }
                // Generic arrays
                if (Array.isArray(data)) {
                    loggerService.catInfo(LogCategory.MONITORING, `Itemized ${data.length} items from generic array API`);
                    return data;
                }
            } catch (e) { 
                loggerService.catWarn(LogCategory.MONITORING, `JSON parse failed during itemization for ${source.name}`, { error: e });
            }
        }

        // Use model to itemize complex or unknown formats
        const prompt = `Itemize the following raw data from source "${source.name}" into a list of distinct articles or events.
        Include 'id' (if available), 'title', 'content', and 'link' for each item.
        
        Raw Data:
        ${rawData.slice(0, 8000)}

        Output valid JSON: { "items": [{ "id": "...", "title": "...", "content": "...", "link": "..." }, ...] }`;

        try {
            let response: any = {};
            if (settings.provider === 'gemini') {
                const client = await getGeminiClient();
                const model = client.getGenerativeModel({ model: fastModel, generationConfig: { responseMimeType: "application/json" } });
                const result = await model.generateContent(prompt);
                response = extractJson(result.response.text());
            } else {
                const client = await getClient();
                const result = await client.chat.completions.create({
                    model: fastModel,
                    messages: [{ role: "user", content: prompt }],
                    response_format: { type: "json_object" }
                });
                response = extractJson(result.choices[0]?.message?.content || "{}");
            }
            return response.items || null;
        } catch (error) {
            loggerService.catError(LogCategory.MONITORING, "Itemization failed", { error });
            return null;
        }
    }

    private async summarizeArticle(source: MonitoringSourceConfig, item: any): Promise<string | null> {
        const settings = await settingsService.getInferenceSettings();
        const fastModel = settings.fastModel;
        if (!fastModel) return null;

        const prompt = `Summarize the following article/event from source "${source.name}". 
        Focus on identifying the core delta (the change in the world).
        
        Article:
        ${JSON.stringify(item)}

        Output a concise bulleted summary.`;

        try {
            if (settings.provider === 'gemini') {
                const client = await getGeminiClient();
                const model = client.getGenerativeModel({ model: fastModel });
                const result = await model.generateContent(prompt);
                return result.response.text().trim();
            } else {
                const client = await getClient();
                const result = await client.chat.completions.create({
                    model: fastModel,
                    messages: [{ role: "user", content: prompt }]
                });
                return result.choices[0]?.message?.content?.trim() || null;
            }
        } catch (error) {
            loggerService.catError(LogCategory.MONITORING, "Article summarization failed", { error });
            return null;
        }
    }

    private async summarizeRawData(source: MonitoringSourceConfig, rawData: string): Promise<{ hasChanges: boolean, content: string } | null> {
        const settings = await settingsService.getInferenceSettings();
        const fastModel = settings.fastModel;
        if (!fastModel) return null;

        const prompt = `You are a world-state monitoring agent. Analyze the following raw data from source "${source.name}" and create a concise summary of significant changes or new information since the last observation.
        
        Raw Data:
        ${rawData.slice(0, 10000)}

        If there are no significant changes, output { "hasChanges": false }.
        If there are changes, output a concise bulleted summary of the deltas.
        Output valid JSON: { "hasChanges": boolean, "content": "..." }`;

        try {
            let response: any = {};
            if (settings.provider === 'gemini') {
                const client = await getGeminiClient();
                const model = client.getGenerativeModel({ model: fastModel, generationConfig: { responseMimeType: "application/json" } });
                const result = await model.generateContent(prompt);
                response = extractJson(result.response.text());
            } else {
                const client = await getClient();
                const result = await client.chat.completions.create({
                    model: fastModel,
                    messages: [{ role: "user", content: prompt }],
                    response_format: { type: "json_object" }
                });
                response = extractJson(result.choices[0]?.message?.content || "{}");
            }
            return response;
        } catch (error) {
            loggerService.catError(LogCategory.MONITORING, "Summarization failed", { error });
            return null;
        }
    }

    private async recordDelta(sourceId: string, period: MonitoringPeriod, content: string) {
        const delta: MonitoringDelta = {
            id: `delta-${randomUUID()}`,
            sourceId,
            period,
            content,
            timestamp: new Date().toISOString()
        };

        // Persist to SQLite
        sqliteService.run(
            `INSERT INTO monitoring_deltas (id, source_id, period, content, timestamp) VALUES (?, ?, ?, ?, ?)`,
            [delta.id, delta.sourceId, delta.period, delta.content, delta.timestamp]
        );

        // Index in LanceDB
        await lancedbService.indexDeltaBatch([delta]);
        
        loggerService.catInfo(LogCategory.MONITORING, `Recorded new ${period} delta for ${sourceId}`);
    }

    private async checkRollups() {
        const periods: MonitoringPeriod[] = ['hour', 'day', 'week', 'month'];
        const periodMap: Record<MonitoringPeriod, { next: MonitoringPeriod, count: number }> = {
            'hour': { next: 'day', count: 24 },
            'day': { next: 'week', count: 7 },
            'week': { next: 'month', count: 4 },
            'month': { next: 'year', count: 12 },
            'year': { next: 'year', count: 0 } // Terminal
        };

        for (const p of periods) {
            const rollupInfo = periodMap[p];
            // Find sources that have enough deltas for the next period rollup
            const sources = sqliteService.all(`SELECT DISTINCT source_id FROM monitoring_deltas WHERE period = ?`, [p]);
            
            for (const { source_id } of sources) {
                const deltas = sqliteService.all(
                    `SELECT * FROM monitoring_deltas WHERE source_id = ? AND period = ? ORDER BY timestamp DESC LIMIT ?`,
                    [source_id, p, rollupInfo.count]
                );

                if (deltas.length >= rollupInfo.count) {
                    // Check if we already rolled up recently for this source/next-period
                    const existing = sqliteService.get(
                        `SELECT id FROM monitoring_deltas WHERE source_id = ? AND period = ? AND timestamp > datetime('now', '-1 ${rollupInfo.next}')`,
                        [source_id, rollupInfo.next]
                    );

                    if (!existing) {
                        await this.performRollup(source_id, p, rollupInfo.next, deltas);
                    }
                }
            }
        }
    }

    private async performRollup(sourceId: string, fromPeriod: MonitoringPeriod, toPeriod: MonitoringPeriod, deltas: any[]) {
        loggerService.catInfo(LogCategory.MONITORING, `Performing ${toPeriod} rollup for ${sourceId}`);
        
        const settings = await settingsService.getInferenceSettings();
        const fastModel = settings.fastModel;
        if (!fastModel) return;

        const combinedContent = deltas.map(d => `[${d.timestamp}] ${d.content}`).join('\n\n---\n\n');
        const prompt = `Synthesize the following ${fromPeriod} deltas for "${sourceId}" into a single comprehensive ${toPeriod} summary.
        Focus on identifying long-term trends and major shifts.
        
        Deltas:
        ${combinedContent}

        Output a concise synthesized summary.`;

        try {
            let summary = "";
            if (settings.provider === 'gemini') {
                const client = await getGeminiClient();
                const model = client.getGenerativeModel({ model: fastModel });
                const result = await model.generateContent(prompt);
                summary = result.response.text().trim();
            } else {
                const client = await getClient();
                const result = await client.chat.completions.create({
                    model: fastModel,
                    messages: [{ role: "user", content: prompt }]
                });
                summary = result.choices[0]?.message?.content?.trim() || "";
            }

            if (summary) {
                await this.recordDelta(sourceId, toPeriod, summary);
            }
        } catch (error) {
            loggerService.catError(LogCategory.MONITORING, "Rollup synthesis failed", { error });
        }
    }
}

export const monitoringService = new MonitoringService();
