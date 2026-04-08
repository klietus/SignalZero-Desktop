import { settingsService } from './settingsService.js';
import { loggerService, LogCategory } from './loggerService.js';
import { sqliteService } from './sqliteService.js';
import { lancedbService } from './lancedbService.js';
import { getClient, getGeminiClient, extractJson } from './inferenceService.js';
import { MonitoringSourceConfig, MonitoringDelta, MonitoringPeriod } from '../types.js';
import { randomUUID } from 'crypto';

const PREBUILT_SOURCES: MonitoringSourceConfig[] = [
    { id: 'acled', name: 'ACLED (Conflict Data)', enabled: false, url: 'https://acleddata.com/api/acled/read?limit=10', pollingIntervalMs: 86400000, type: 'api' },
    { id: 'gdelt', name: 'GDELT (Global Events)', enabled: false, url: 'https://api.gdeltproject.org/api/v2/doc/doc?query=world&mode=artlist&format=json&maxrecords=10', pollingIntervalMs: 3600000, type: 'api' },
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
    private tokens: Map<string, { token: string, expires: number }> = new Map();
    private isRunning = false;

    async initialize() {
        if (this.isRunning) return;
        this.isRunning = true;
        
        loggerService.catInfo(LogCategory.MONITORING, "Initializing Monitoring Service");

        // Ensure prebuilt sources exist in settings
        const settings = await settingsService.getMonitoringSettings();
        let changed = false;
        for (const prebuilt of PREBUILT_SOURCES) {
            if (!settings.sources.find(s => s.id === prebuilt.id)) {
                settings.sources.push(prebuilt);
                changed = true;
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

    private async getAcledToken(source: MonitoringSourceConfig): Promise<string | null> {
        const cached = this.tokens.get(source.id);
        if (cached && cached.expires > Date.now() + 60000) {
            return cached.token;
        }

        const email = source.metadata?.email;
        const password = source.metadata?.apiKey; // We reuse apiKey field for password

        if (!email || !password) {
            throw new Error("ACLED requires both email and password (set in API Key field)");
        }

        loggerService.catInfo(LogCategory.MONITORING, "Fetching new ACLED access token...");
        
        const resp = await fetch("https://acleddata.com/oauth/token", {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                username: email,
                password: password,
                grant_type: 'password',
                client_id: 'acled'
            })
        });

        if (!resp.ok) {
            const err = await resp.text();
            throw new Error(`ACLED Auth failed: ${resp.status} ${err}`);
        }

        const data = await resp.json();
        if (data.access_token) {
            this.tokens.set(source.id, {
                token: data.access_token,
                expires: Date.now() + (data.expires_in * 1000)
            });
            return data.access_token;
        }
        return null;
    }

    private async pollSource(source: MonitoringSourceConfig) {
        loggerService.catDebug(LogCategory.MONITORING, `Polling source: ${source.name}`);
        try {
            let url = source.url;
            const apiKey = source.metadata?.apiKey;
            const headers: Record<string, string> = {};

            if (source.id === 'acled') {
                const token = await this.getAcledToken(source);
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }
            } else if (apiKey) {
                if (source.id === 'alphavantage') url += `&apikey=${apiKey}`;
                else if (source.id.includes('stack')) url += `&access_key=${apiKey}`;
                else if (source.id === 'marinetraffic') url = url.replace('YOUR_KEY', apiKey);
            }

            let rawData = "";
            if (source.type === 'rss' || source.type === 'web') {
                const resp = await fetch(url, { headers });
                rawData = await resp.text();
            } else if (source.type === 'api') {
                const resp = await fetch(url, { headers });
                const data = await resp.json();
                rawData = JSON.stringify(data);
            }

            if (!rawData) return;

            const summary = await this.summarizeRawData(source, rawData);
            if (summary && summary.hasChanges) {
                await this.recordDelta(source.id, 'hour', summary.content);
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
