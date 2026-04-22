import { webFetchService } from './webFetchService.js';
import { documentMeaningService } from './documentMeaningService.js';
import { settingsService } from './settingsService.js';
import { loggerService, LogCategory } from './loggerService.js';
import { sqliteService } from './sqliteService.js';
import { lancedbService } from './lancedbService.js';
import { eventBusService } from './eventBusService.js';
import { getClient, getGeminiClient, extractJson, callFastInference } from './inferenceService.js';
import { LlamaPriority } from './llamaService.js';
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

                // Initial poll with a small settle-delay to avoid first-run network jitter
                setTimeout(() => this.pollSource(source), 5000);
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

                let skippedCount = 0;
                for (const item of items) {
                    let articleId = item.id || item.link || item.title;
                    if (!articleId) continue;

                    // Ensure articleId is a string or number (not an object from a complex API)
                    if (typeof articleId !== 'string' && typeof articleId !== 'number') {
                        articleId = JSON.stringify(articleId);
                    }

                    // 2. Check SQLite cache
                    const cached = sqliteService.get(
                        `SELECT summary FROM monitoring_article_cache WHERE source_id = ? AND article_id = ?`,
                        [String(source.id), articleId]
                    );

                    if (cached) {
                        skippedCount++;
                        continue;
                    }

                    // 3. Summarize new article
                    const result = await this.summarizeArticle(source, item);
                    if (result) {
                        // 4. Cache the result
                        sqliteService.run(
                            `INSERT INTO monitoring_article_cache (source_id, article_id, summary) VALUES (?, ?, ?)`,
                            [String(source.id), articleId, result.summary]
                        );

                        // 5. Feed to delta engine
                        const metadata = {
                            articleUrl: item.link || item.url,
                            imageUrl: result.imageUrl || item.image || item.imageUrl,
                            imageSummary: result.imageDescription
                        };
                        await this.recordDelta(source.id, 'hour', result.summary, undefined, metadata);
                    }
                }
                if (skippedCount > 0) {
                    loggerService.catDebug(LogCategory.MONITORING, `Skipped ${skippedCount} cached items for ${source.name}`);
                }
            } else {
                // Fallback for non-itemized or failed itemization
                const summary = await this.summarizeRawData(source, rawData);
                if (summary && summary.hasChanges) {
                    await this.recordDelta(source.id, 'hour', summary.content, undefined, {
                        articleUrl: summary.articleUrl,
                        imageUrl: summary.imageUrl,
                        imageSummary: summary.imageSummary
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

        } catch (error: any) {
            loggerService.catError(LogCategory.MONITORING, `Failed to poll source: ${source.name}`, {
                error: error.message,
                cause: error.cause,
                stack: error.stack
            });
        }
    }

    private async itemizeData(source: MonitoringSourceConfig, rawData: string): Promise<any[] | null> {
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
                    image: item.enclosure?.url || (item as any).itunes?.image || (item as any).mediaContent?.$?.url || (item as any).image?.url
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
                    const articles = data.articles.map((a: any) => ({
                        ...a,
                        image: a.socialimage || a.image
                    }));
                    loggerService.catInfo(LogCategory.MONITORING, `Itemized ${articles.length} articles from GDELT API`);
                    return articles;
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
            const fastText = await callFastInference([{ role: "user", content: prompt }], 2048, undefined, LlamaPriority.LOW);
            const response = await extractJson(fastText);
            return response.items || null;
        } catch (error) {
            loggerService.catError(LogCategory.MONITORING, "Itemization failed", { error });
            return null;
        }
    }

    private async withRetries<T>(
        operation: () => Promise<T>,
        isValid: (result: T) => boolean,
        context: string,
        maxRetries = 2
    ): Promise<T | null> {
        let lastResult: T | null = null;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                lastResult = await operation();
                if (isValid(lastResult)) {
                    return lastResult;
                }
                loggerService.catWarn(LogCategory.MONITORING, `Attempt ${attempt + 1} for ${context} returned invalid/empty result. Retrying...`);
            } catch (err) {
                loggerService.catError(LogCategory.MONITORING, `Attempt ${attempt + 1} for ${context} failed`, { error: err });
            }
            if (attempt < maxRetries) {
                // Short backoff
                await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
            }
        }
        loggerService.catError(LogCategory.MONITORING, `All ${maxRetries + 1} attempts for ${context} failed or returned invalid results.`);
        return lastResult;
    }

    private async summarizeArticle(source: MonitoringSourceConfig, item: any): Promise<{ summary: string, imageUrl?: string, imageDescription?: string } | null> {
        let articleData = item;
        let imageUrl = item.image || item.imageUrl;
        let imageDescription = "";

        // --- NEW: Leverage WebFetchService for full content and images ---
        if (item.link && (source.type === 'rss' || source.type === 'web' || source.type === 'api')) {
            try {
                loggerService.catDebug(LogCategory.MONITORING, `Fetching full content for article: ${item.link}`);
                const fetchResult = await webFetchService.fetch(item.link);
                if (fetchResult) {
                    articleData = {
                        ...item,
                        title: fetchResult.title || item.title,
                        content: fetchResult.content || item.content,
                        excerpt: fetchResult.excerpt || item.excerpt
                    };
                    if (fetchResult.extracted.imageUrl) {
                        imageUrl = fetchResult.extracted.imageUrl;
                    }
                    if (fetchResult.extracted.imageDescription) {
                        imageDescription = fetchResult.extracted.imageDescription;
                    }
                }
            } catch (err) {
                loggerService.catWarn(LogCategory.MONITORING, `WebFetchService failed for ${item.link}, falling back to item data`, { error: err });
            }
        }

        // --- Fallback: Describe image if we have a URL but no description yet ---
        if (imageUrl && !imageDescription) {
            try {
                loggerService.catDebug(LogCategory.MONITORING, `Describing article image: ${imageUrl}`);
                const imgResp = await fetch(imageUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                    signal: AbortSignal.timeout(10000)
                });
                if (imgResp.ok) {
                    const buffer = await imgResp.arrayBuffer();
                    const contentType = imgResp.headers.get('content-type') || 'image/jpeg';
                    const meaning = await documentMeaningService.parse(Buffer.from(buffer), contentType, imageUrl, articleData.title);
                    if (meaning.type === 'image' && meaning.content) {
                        imageDescription = meaning.content;
                    }
                }
            } catch (err) {
                loggerService.catDebug(LogCategory.MONITORING, "Failed to fetch/describe article image", { error: err });
            }
        }

        const prompt = `### WORLD-STATE MONITORING AGENT
Summarize the following article/event from source "${source.name}". 

GOAL: Extract the core DELTA (the meaningful change in the world state). 
TONE: Dense, high-fidelity, and ultra-concise. No conversational filler.

ARTICLE DATA:
${JSON.stringify(articleData)}

${imageDescription ? `VISUAL CONTEXT (Image Description): ${imageDescription}` : ""}

#### OUTPUT INSTRUCTIONS:
- Provide a concise bulleted summary of the facts.
- Incorporate visual details only if they add critical evidence.
- Focus on "What changed?" and "Why does it matter?".`;

        return this.withRetries(
            async () => {
                const summary = await callFastInference([{ role: "user", content: prompt }], 8192, undefined, LlamaPriority.LOW);
                return {
                    summary: (summary || "").trim(),
                    imageUrl,
                    imageDescription
                };
            },
            (result) => !!result?.summary,
            `summarizeArticle (${source.name})`
        );
    }

    private async summarizeRawData(source: MonitoringSourceConfig, rawData: string): Promise<{ hasChanges: boolean, content: string, articleUrl?: string, imageUrl?: string, imageSummary?: string } | null> {
        const prompt = `You are a world-state monitoring agent. Analyze the following raw data from source "${source.name}" and create a concise summary of significant changes or new information since the last observation.
        
        Raw Data:
        ${rawData.slice(0, 10000)}

        If there are no significant changes, output { "hasChanges": false }.
        If there are changes:
        1. Identify a primary 'articleUrl' if one exists in the data.
        2. Identify a primary 'imageUrl' if one exists in the data.
        3. Identify a concise 'imageSummary' if an image is present.
        4. Provide a concise bulleted summary of the deltas in 'content'.
        
        Output valid JSON: { "hasChanges": boolean, "content": "...", "articleUrl": "...", "imageUrl": "...", "imageSummary": "..." }`;

        return this.withRetries(
            async () => {
                const fastText = await callFastInference([{ role: "user", content: prompt }], 4192, undefined, LlamaPriority.LOW);
                const response = await extractJson(fastText);
                return response;
            },
            (result) => result && (result.hasChanges === false || (result.hasChanges === true && !!result.content)),
            `summarizeRawData (${source.name})`
        );
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
            [delta.id, String(delta.sourceId), String(delta.period), delta.content, delta.timestamp, JSON.stringify(delta.metadata)]
        );

        // Index in LanceDB
        await lancedbService.indexDeltaBatch([delta]);

        // Notify any listeners (e.g. Agents) - ONLY if monitoring is enabled globally
        const settings = await settingsService.getMonitoringSettings();
        if (settings.enabled) {
            eventBusService.emitKernelEvent('monitoring:delta-created' as any, delta);
        }

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
        const agentModel = settings.agentModel;
        if (!agentModel) return;

        const combinedData = deltas.map(d => {
            const meta = typeof d.metadata === 'string' ? JSON.parse(d.metadata) : (d.metadata || {});
            return {
                timestamp: d.timestamp,
                content: d.content,
                imageUrl: meta.imageUrl,
                imageSummary: meta.imageSummary,
                articleUrl: meta.articleUrl
            };
        });

        const prompt = `Synthesize the following ${fromPeriod} deltas for "${sourceId}" into a comprehensive ${toPeriod} report.
        
        The report MUST include:
        1. **KEY THEMES**: A high-level synthesis of the most significant trends and shifts during this period.
        2. **HIGHLIGHTED EVENTS**: A list of the top ten most important individual delta provided. For each selected delta, include a concise one-line summary for each.
        3. **FEATURED HIGHLIGHT**: Identify the single most impactful event or trend from this period. Extract its 'articleUrl', 'imageUrl', and 'imageSummary'.

        Deltas to synthesize:
        ${JSON.stringify(combinedData)}

        Output valid JSON:
        {
          "content": "The full formatted report text (using markdown for themes and the detailed log)",
          "featuredEvent": {
            "articleUrl": "URL for the highlight (if any)",
            "imageUrl": "Image URL for the highlight (if any)",
            "imageSummary": "Image description for the highlight (if any)"
          }
        }`;

        const response = await this.withRetries(
            async () => {
                let res: any = {};
                if (settings.provider === 'gemini') {
                    const client = await getGeminiClient();
                    const model = client.getGenerativeModel({
                        model: agentModel,
                        generationConfig: { maxOutputTokens: 4096 }
                    });
                    const result = await model.generateContent(prompt);
                    res = extractJson(result.response.text());
                } else {
                    const client = await getClient();
                    const result = await client.chat.completions.create({
                        model: agentModel,
                        messages: [{ role: "user", content: prompt }],
                        max_tokens: 16384
                    });
                    res = extractJson(result.choices[0]?.message?.content || "{}");
                }
                return res;
            },
            (result) => result && !!result.content,
            `performRollup (${sourceId}, ${toPeriod})`
        );

        if (response && response.content) {
            const metadata = {
                articleUrl: response.featuredEvent?.articleUrl,
                imageUrl: response.featuredEvent?.imageUrl,
                imageSummary: response.featuredEvent?.imageSummary,
                isRollup: true,
                constituentCount: deltas.length
            };

            if (existingId) {
                // Update existing
                sqliteService.run(
                    `UPDATE monitoring_deltas SET content = ?, timestamp = ?, metadata = ? WHERE id = ?`,
                    [response.content, customTimestamp || new Date().toISOString(), JSON.stringify(metadata), existingId]
                );
                // Re-index in LanceDB
                const delta = sqliteService.get(`SELECT * FROM monitoring_deltas WHERE id = ?`, [existingId]);
                if (delta) await lancedbService.indexDeltaBatch([delta]);
            } else {
                await this.recordDelta(sourceId, toPeriod, response.content, customTimestamp, metadata);
            }
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

            const meta = typeof delta.metadata === 'string' ? JSON.parse(delta.metadata) : (delta.metadata || {});
            let articleContent = delta.content;
            let imageUrl = meta.imageUrl;
            let imageDescription = meta.imageSummary || "";

            // --- FULL PIPELINE: Fetch fresh content and images if URL exists ---
            if (meta.articleUrl) {
                try {
                    loggerService.catInfo(LogCategory.MONITORING, `Regeneration: Fetching full content for ${meta.articleUrl}`);
                    const fetchResult = await webFetchService.fetch(meta.articleUrl);
                    if (fetchResult) {
                        articleContent = `Title: ${fetchResult.title}\n\nContent: ${fetchResult.content}`;
                        if (fetchResult.extracted.imageUrl) imageUrl = fetchResult.extracted.imageUrl;
                        if (fetchResult.extracted.imageDescription) imageDescription = fetchResult.extracted.imageDescription;
                    }
                } catch (fetchErr) {
                    loggerService.catWarn(LogCategory.MONITORING, `Regeneration fetch failed, using existing content`, { error: fetchErr });
                }
            }

            const prompt = `Refine and improve the following world-monitoring summary. 
            Focus on identifying the core 'delta' (the change in the world).
            
            ${meta.articleUrl ? 'SOURCE CONTENT:' : 'CURRENT SUMMARY:'}
            ${articleContent}
            
            ${imageDescription ? `VISUAL CONTEXT (Image Description): ${imageDescription}` : ""}

            Output a concise, impactful bulleted summary. Incorporate visual details if relevant.`;

            try {
                const refined = await callFastInference([{ role: "user", content: prompt }], 8192, undefined, LlamaPriority.LOW);

                if (refined) {
                    const updatedMeta = {
                        ...meta,
                        imageUrl,
                        imageSummary: imageDescription
                    };

                    sqliteService.run(
                        `UPDATE monitoring_deltas SET content = ?, metadata = ? WHERE id = ?`,
                        [refined.trim(), JSON.stringify(updatedMeta), deltaId]
                    );

                    const updated = { ...delta, content: refined.trim(), metadata: updatedMeta };
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
