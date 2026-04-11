import { settingsService } from './settingsService.js';
import { loggerService, LogCategory } from './loggerService.js';
import { sqliteService } from './sqliteService.js';
import { lancedbService } from './lancedbService.js';
import { eventBusService } from './eventBusService.js';
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
import { AlJazeeraProvider } from './monitoring/providers/aljazeera.js';
import { MonitoringProvider } from './monitoring/types.js';
import Parser from 'rss-parser';

const rssParser = new Parser();

const PREBUILT_SOURCES: MonitoringSourceConfig[] = [
    { id: 'acled', name: 'ACLED (Conflict Data)', enabled: false, url: 'https://api.acleddata.com/api/acled/read?limit=10&terms_accept=yes', pollingIntervalMs: 86400000, type: 'api' },
    { id: 'gdelt', name: 'GDELT (Global Events)', enabled: false, url: 'https://api.gdeltproject.org/api/v2/doc/doc?query=world&mode=artlist&format=json&maxrecords=20', pollingIntervalMs: 3600000, timeoutMs: 120000, type: 'api' },
    { id: 'alphavantage', name: 'Alpha Vantage (Markets)', enabled: false, url: 'https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=SPY', pollingIntervalMs: 3600000, type: 'api' },
    { id: 'marketstack', name: 'Market Stack (Stocks)', enabled: false, url: 'http://api.marketstack.com/v1/eod?symbols=AAPL', pollingIntervalMs: 86400000, type: 'api' },
    { id: 'aviationstack', name: 'Aviation Stack (Flights)', enabled: false, url: 'http://api.aviationstack.com/v1/flights?limit=10', pollingIntervalMs: 3600000, type: 'api' },
    { id: 'marinetraffic', name: 'Marine Traffic', enabled: false, url: 'https://services.marinetraffic.com/api/exportvessels/v:8/protocol:json', pollingIntervalMs: 3600000, type: 'api' },
    { id: 'times-news', name: 'The New York Times', enabled: false, url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', pollingIntervalMs: 3600000, type: 'rss' },
    { id: 'cnn-news', name: 'CNN World', enabled: false, url: 'http://rss.cnn.com/rss/edition_world.rss', pollingIntervalMs: 3600000, type: 'rss' },
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

        // 1. Add or Update prebuilt sources
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

        // 2. Remove stale system sources (those that were system-provided but are no longer in our list)
        const initialCount = settings.sources.length;
        settings.sources = settings.sources.filter(s => {
            const isSystemSource = !s.id.startsWith('mon-');
            const stillInList = PREBUILT_SOURCES.some(p => p.id === s.id);
            return !isSystemSource || stillInList;
        });

        if (settings.sources.length !== initialCount) {
            loggerService.catInfo(LogCategory.MONITORING, `Removed ${initialCount - settings.sources.length} stale system sources from config`);
            changed = true;
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
                        const metadata = {
                            articleUrl: item.link || item.url,
                            imageUrl: item.image || item.imageUrl
                        };
                        await this.recordDelta(source.id, 'hour', summary, undefined, metadata);
                    }
                }
            } else {
                // Fallback for non-itemized or failed itemization
                const summary = await this.summarizeRawData(source, rawData);
                if (summary && summary.hasChanges) {
                    await this.recordDelta(source.id, 'hour', summary.content, undefined, { 
                        articleUrl: summary.articleUrl,
                        imageUrl: summary.imageUrl
                    });
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
        if (source.type === 'rss') {
            try {
                const feed = await rssParser.parseString(rawData);
                const items = feed.items.map(item => ({
                    id: item.guid || item.link || item.title,
                    title: item.title,
                    content: item.contentSnippet || item.content || item.summary,
                    link: item.link,
                    pubDate: item.pubDate,
                    image: item.enclosure?.url || (item as any).itunes?.image || (item as any).mediaContent?.$?.url
                }));
                loggerService.catInfo(LogCategory.MONITORING, `Itemized ${items.length} items from RSS feed for ${source.name}`);
                return items;
            } catch (rssErr) {
                loggerService.catError(LogCategory.MONITORING, `Failed to parse RSS XML for ${source.name}`, { error: rssErr });
            }
        }

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
                return []; // Return empty instead of null to avoid accidental raw summary of huge JSON error string
            }
        }

        // Use model to itemize complex or unknown formats
        const prompt = `Itemize the following raw data from source "${source.name}" into a list of distinct articles or events.
        Include 'id' (if available), 'title', 'content', 'link', and 'image' (URL if available) for each item.
        
        Raw Data:
        ${rawData.slice(0, 8000)}

        Output valid JSON: { "items": [{ "id": "...", "title": "...", "content": "...", "link": "...", "image": "..." }, ...] }`;

        try {
            let response: any = {};
            if (settings.provider === 'gemini') {
                const client = await getGeminiClient();
                const model = client.getGenerativeModel({ 
                    model: fastModel,
                    generationConfig: { maxOutputTokens: 1024 }
                });
                const result = await model.generateContent(prompt);
                response = extractJson(result.response.text());
            } else {
                const client = await getClient();
                const result = await client.chat.completions.create({
                    model: fastModel,
                    messages: [{ role: "user", content: prompt }],
                    max_tokens: 1024
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
                const model = client.getGenerativeModel({ 
                    model: fastModel,
                    generationConfig: { maxOutputTokens: 1024 }
                });
                const result = await model.generateContent(prompt);
                return result.response.text().trim();
            } else {
                const client = await getClient();
                const result = await client.chat.completions.create({
                    model: fastModel,
                    messages: [{ role: "user", content: prompt }],
                    max_tokens: 1024
                });
                return result.choices[0]?.message?.content?.trim() || null;
            }
        } catch (error) {
            loggerService.catError(LogCategory.MONITORING, "Article summarization failed", { error });
            return null;
        }
    }

    private async summarizeRawData(source: MonitoringSourceConfig, rawData: string): Promise<{ hasChanges: boolean, content: string, articleUrl?: string, imageUrl?: string } | null> {
        const settings = await settingsService.getInferenceSettings();
        const fastModel = settings.fastModel;
        if (!fastModel) return null;

        const prompt = `You are a world-state monitoring agent. Analyze the following raw data from source "${source.name}" and create a concise summary of significant changes or new information since the last observation.
        
        Raw Data:
        ${rawData.slice(0, 10000)}

        If there are no significant changes, output { "hasChanges": false }.
        If there are changes:
        1. Identify a primary 'articleUrl' if one exists in the data.
        2. Identify a primary 'imageUrl' if one exists in the data.
        3. Provide a concise bulleted summary of the deltas in 'content'.
        
        Output valid JSON: { "hasChanges": boolean, "content": "...", "articleUrl": "...", "imageUrl": "..." }`;

        try {
            let response: any = {};
            if (settings.provider === 'gemini') {
                const client = await getGeminiClient();
                const model = client.getGenerativeModel({ 
                    model: fastModel,
                    generationConfig: { maxOutputTokens: 1024 }
                });
                const result = await model.generateContent(prompt);
                response = extractJson(result.response.text());
            } else {
                const client = await getClient();
                const result = await client.chat.completions.create({
                    model: fastModel,
                    messages: [{ role: "user", content: prompt }],
                    max_tokens: 1024
                });
                response = extractJson(result.choices[0]?.message?.content || "{}");
            }
            return response;
        } catch (error) {
            loggerService.catError(LogCategory.MONITORING, "Summarization failed", { error });
            return null;
        }
    }

    private async recordDelta(sourceId: string, period: MonitoringPeriod, content: any, customTimestamp?: string, metadata?: Record<string, any>) {
        const finalContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
        const timestamp = customTimestamp || new Date().toISOString();

        const delta: MonitoringDelta = {
            id: `delta-${randomUUID()}`,
            sourceId,
            period,
            content: finalContent,
            timestamp,
            metadata: metadata || {}
        };

        // Persist to SQLite
        sqliteService.run(
            `INSERT INTO monitoring_deltas (id, source_id, period, content, timestamp, metadata) VALUES (?, ?, ?, ?, ?, ?)`,
            [delta.id, delta.sourceId, delta.period, delta.content, delta.timestamp, JSON.stringify(delta.metadata)]
        );

        // Index in LanceDB
        await lancedbService.indexDeltaBatch([delta]);
        
        // Notify any listeners (e.g. Agents)
        eventBusService.emitKernelEvent('monitoring:delta-created' as any, delta);

        loggerService.catInfo(LogCategory.MONITORING, `Recorded new ${period} delta for ${sourceId} at ${timestamp}`, { metadata });
    }

    /**
     * Ensures a rollup exists for the given period and time range.
     * If not found, it recursively rolls up smaller periods to generate it.
     * If found but "stale" (new sub-data available), it re-synthesizes.
     */
    async ensureRollup(sourceId: string, period: MonitoringPeriod, startDate: string, endDate: string): Promise<MonitoringDelta[]> {
        // 1. Check for existing
        const existing = sqliteService.all(
            `SELECT * FROM monitoring_deltas WHERE source_id = ? AND period = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC`,
            [sourceId, period, startDate, endDate]
        );

        const periodOrder: MonitoringPeriod[] = ['hour', 'day', 'week', 'month', 'year'];
        const currentIdx = periodOrder.indexOf(period);
        const prevPeriod = periodOrder[currentIdx - 1];

        if (existing.length > 0) {
            // Check for staleness: Are there newer sub-deltas than this rollup?
            if (period !== 'hour') {
                const latestRollupTime = existing[0].timestamp;
                const newerSubData = sqliteService.get(
                    `SELECT id FROM monitoring_deltas WHERE source_id = ? AND period = ? AND timestamp > ? AND timestamp <= ? LIMIT 1`,
                    [sourceId, prevPeriod, latestRollupTime, endDate]
                );

                if (!newerSubData) {
                    return existing; // Not stale
                }
                loggerService.catInfo(LogCategory.MONITORING, `Rollup ${period} for ${sourceId} is stale. Re-synthesizing...`);
            } else {
                return existing;
            }
        }

        // 2. If base layer 'hour', we can't roll up
        if (period === 'hour') return [];

        loggerService.catInfo(LogCategory.MONITORING, `Dynamic rollup requested: ${period} for ${sourceId} from ${startDate} to ${endDate}. Synthesizing from ${prevPeriod}...`);

        // Recursively ensure we have the previous period deltas
        const subDeltas = await this.ensureRollup(sourceId, prevPeriod, startDate, endDate);
        
        if (subDeltas.length === 0) {
            loggerService.catWarn(LogCategory.MONITORING, `Cannot synthesize ${period}: No ${prevPeriod} deltas found in range.`);
            return [];
        }

        // Perform the synthesis
        await this.performRollup(sourceId, prevPeriod, period, subDeltas, endDate, existing[0]?.id);

        // Fetch and return
        return sqliteService.all(
            `SELECT * FROM monitoring_deltas WHERE source_id = ? AND period = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC`,
            [sourceId, period, startDate, endDate]
        );
    }

    private async checkRollups() {
        const periods: MonitoringPeriod[] = ['hour', 'day', 'week', 'month'];
        const periodMap: Record<MonitoringPeriod, { next: MonitoringPeriod, count: number, window: string }> = {
            'hour': { next: 'day', count: 24, window: '1 day' },
            'day': { next: 'week', count: 7, window: '7 days' },
            'week': { next: 'month', count: 4, window: '30 days' },
            'month': { next: 'year', count: 12, window: '365 days' },
            'year': { next: 'year', count: 0, window: '' } 
        };

        for (const p of periods) {
            const rollupInfo = periodMap[p];
            const sources = sqliteService.all(`SELECT DISTINCT source_id FROM monitoring_deltas WHERE period = ?`, [p]);
            
            for (const { source_id } of sources) {
                // Get most recent 50 deltas in the current window for this period to prevent context explosion
                const deltas = sqliteService.all(
                    `SELECT * FROM monitoring_deltas WHERE source_id = ? AND period = ? AND timestamp > datetime('now', '-${rollupInfo.window}') ORDER BY timestamp DESC LIMIT 50`,
                    [source_id, p]
                );

                if (deltas.length > 0) {
                    // Check for existing rollup in the same window
                    const existing = sqliteService.get(
                        `SELECT id, timestamp FROM monitoring_deltas WHERE source_id = ? AND period = ? AND timestamp > datetime('now', '-${rollupInfo.window}')`,
                        [source_id, rollupInfo.next]
                    );

                    if (!existing) {
                        // Only auto-create if we have at least half the expected count to avoid jitter
                        if (deltas.length >= (rollupInfo.count / 2)) {
                            await this.performRollup(source_id, p, rollupInfo.next, deltas);
                        }
                    } else {
                        // Update if stale
                        const newerSubData = sqliteService.get(
                            `SELECT id FROM monitoring_deltas WHERE source_id = ? AND period = ? AND timestamp > ? LIMIT 1`,
                            [source_id, p, existing.timestamp]
                        );
                        if (newerSubData) {
                            await this.performRollup(source_id, p, rollupInfo.next, deltas, new Date().toISOString(), existing.id);
                        }
                    }
                }
            }
        }
    }

    private async performRollup(sourceId: string, fromPeriod: MonitoringPeriod, toPeriod: MonitoringPeriod, deltas: any[], customTimestamp?: string, existingId?: string) {
        loggerService.catInfo(LogCategory.MONITORING, `${existingId ? 'Updating' : 'Performing'} ${toPeriod} rollup for ${sourceId}`);
        
        const settings = await settingsService.getInferenceSettings();
        const fastModel = settings.fastModel;
        if (!fastModel) return;

        const combinedContent = deltas.map(d => {
            const truncatedContent = (d.content || "").slice(0, 1000);
            return `[${d.timestamp}] ${truncatedContent}`;
        }).join('\n\n---\n\n');
        const prompt = `Synthesize the following ${fromPeriod} deltas for "${sourceId}" into a single comprehensive ${toPeriod} summary.
        Focus on identifying long-term trends and major shifts.
        
        Deltas:
        ${combinedContent}

        Output a concise synthesized summary.`;

        try {
            let summary = "";
            if (settings.provider === 'gemini') {
                const client = await getGeminiClient();
                const model = client.getGenerativeModel({ 
                    model: fastModel,
                    generationConfig: { maxOutputTokens: 1024 }
                });
                const result = await model.generateContent(prompt);
                summary = result.response.text().trim();
            } else {
                const client = await getClient();
                const result = await client.chat.completions.create({
                    model: fastModel,
                    messages: [{ role: "user", content: prompt }],
                    max_tokens: 1024
                });
                summary = result.choices[0]?.message?.content?.trim() || "";
            }

            if (summary) {
                if (existingId) {
                    // Update existing
                    sqliteService.run(
                        `UPDATE monitoring_deltas SET content = ?, timestamp = ? WHERE id = ?`,
                        [summary, customTimestamp || new Date().toISOString(), existingId]
                    );
                    // Re-index in LanceDB (LanceDB replace is handled by delete then add in our service)
                    const delta = sqliteService.get(`SELECT * FROM monitoring_deltas WHERE id = ?`, [existingId]);
                    if (delta) await lancedbService.indexDeltaBatch([delta]);
                } else {
                    await this.recordDelta(sourceId, toPeriod, summary, customTimestamp);
                }
            }
        } catch (error) {
            loggerService.catError(LogCategory.MONITORING, "Rollup synthesis failed", { error });
        }
    }

    async regenerateDelta(deltaId: string): Promise<MonitoringDelta | null> {
        loggerService.catInfo(LogCategory.MONITORING, `Regenerating delta: ${deltaId}`);
        const delta = sqliteService.get(`SELECT * FROM monitoring_deltas WHERE id = ?`, [deltaId]);
        if (!delta) {
            loggerService.catError(LogCategory.MONITORING, `Delta not found for regeneration: ${deltaId}`);
            return null;
        }

        const periodOrder: MonitoringPeriod[] = ['hour', 'day', 'week', 'month', 'year'];
        const idx = periodOrder.indexOf(delta.period);

        if (delta.period === 'hour') {
            loggerService.catInfo(LogCategory.MONITORING, `Refining hour delta: ${deltaId}`);
            // For hour deltas, we re-summarize the existing content to "refine" it, 
            // since we don't store the original raw data for efficiency.
            const settings = await settingsService.getInferenceSettings();
            const fastModel = settings.fastModel;
            if (!fastModel) return delta;

            const prompt = `Refine and improve the following world-monitoring summary. 
            Ensure it is concise, impactful, and captures the core 'delta' accurately.
            
            Current Summary:
            ${delta.content}
            
            Output the refined summary only.`;

            try {
                let refined = "";
                if (settings.provider === 'gemini') {
                    const client = await getGeminiClient();
                    const model = client.getGenerativeModel({ 
                        model: fastModel,
                        generationConfig: { maxOutputTokens: 1024 }
                    });
                    const result = await model.generateContent(prompt);
                    refined = result.response.text().trim();
                } else {
                    const client = await getClient();
                    const result = await client.chat.completions.create({
                        model: fastModel,
                        messages: [{ role: "user", content: prompt }],
                        max_tokens: 1024
                    });
                    refined = result.choices[0]?.message?.content?.trim() || "";
                }

                if (refined) {
                    sqliteService.run(`UPDATE monitoring_deltas SET content = ? WHERE id = ?`, [refined, deltaId]);
                    const updated = { ...delta, content: refined };
                    await lancedbService.indexDeltaBatch([updated]);
                    return updated;
                }
            } catch (error) {
                loggerService.catError(LogCategory.MONITORING, "Delta regeneration failed", { error });
            }
            return delta;
        } else {
            // It's a rollup. Find constituent sub-deltas.
            const prevPeriod = periodOrder[idx - 1];
            loggerService.catInfo(LogCategory.MONITORING, `Re-synthesizing ${delta.period} rollup from ${prevPeriod} deltas`);
            
            // Find deltas of prevPeriod that occurred BEFORE or AT this delta's timestamp,
            // going back one unit of the current period.
            // For simplicity, we'll take the latest 50 sub-deltas that precede this one.
            const subDeltas = sqliteService.all(
                `SELECT * FROM monitoring_deltas WHERE source_id = ? AND period = ? AND timestamp <= ? ORDER BY timestamp DESC LIMIT 50`,
                [delta.source_id, prevPeriod, delta.timestamp]
            );

            if (subDeltas.length > 0) {
                loggerService.catInfo(LogCategory.MONITORING, `Found ${subDeltas.length} sub-deltas for regeneration`);
                await this.performRollup(delta.source_id, prevPeriod, delta.period, subDeltas, delta.timestamp, delta.id);
                return sqliteService.get(`SELECT * FROM monitoring_deltas WHERE id = ?`, [deltaId]);
            } else {
                loggerService.catWarn(LogCategory.MONITORING, `No sub-deltas found for ${delta.period} rollup regeneration`, { source_id: delta.source_id, prevPeriod });
            }
        }
        return delta;
    }
}

export const monitoringService = new MonitoringService();
