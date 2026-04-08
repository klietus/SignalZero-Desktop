import { settingsService } from './settingsService.js';
import { getClient, getGeminiClient, extractJson } from './inferenceService.js';
import { loggerService, LogCategory } from './loggerService.js';

export interface WebFetchResult {
    url: string;
    title: string;
    content: string;
    excerpt: string;
    extracted: {
        actors: string[];
        verbatim_statements: string[];
        summary: string;
        events: string[];
        time: string;
    };
}

export const webFetchService = {
    async fetch(url: string): Promise<WebFetchResult | null> {
        loggerService.catInfo(LogCategory.TOOL, `WebFetchService: Fetching and extracting from ${url}`);
        
        try {
            // Dynamically import ESM modules to avoid startup errors in CJS environment
            const { JSDOM } = await import('jsdom');
            const { Readability } = await import('@mozilla/readability');

            const resp = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
                }
            });

            if (!resp.ok) {
                throw new Error(`Fetch failed with status ${resp.status}`);
            }

            const html = await resp.text();
            const dom = new JSDOM(html, { url });
            const reader = new Readability(dom.window.document);
            const article = reader.parse();

            if (!article || !article.textContent) {
                throw new Error("Failed to parse article content from HTML");
            }

            const cleanText = article.textContent.trim().replace(/\s+/g, ' ');
            const metadata = await this.extractMetadata(cleanText, url);

            return {
                url,
                title: article.title || "",
                content: cleanText,
                excerpt: article.excerpt || "",
                extracted: metadata
            };

        } catch (error: any) {
            loggerService.catError(LogCategory.TOOL, `WebFetchService: Error processing ${url}`, { error: error.message });
            return null;
        }
    },

    async extractMetadata(text: string, url: string): Promise<any> {
        const settings = await settingsService.getInferenceSettings();
        const fastModel = settings.fastModel;
        if (!fastModel) throw new Error("Fast model not configured");

        const prompt = `Analyze the following text from ${url} and extract structured information.
        
        TEXT:
        ${text.slice(0, 10000)}

        Return ONLY valid JSON matching this schema:
        {
            "actors": ["List of primary entities/people involved"],
            "verbatim_statements": ["Key direct quotes or specific declarations"],
            "summary": "Concise summary of the core information",
            "events": ["Timeline of specific events mentioned"],
            "time": "The primary timeframe of the content"
        }`;

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
                    response_format: settings.provider === 'local' ? undefined : { type: "json_object" }
                });
                response = extractJson(result.choices[0]?.message?.content || "{}");
            }
            return response;
        } catch (error) {
            loggerService.catError(LogCategory.TOOL, "WebFetchService: Metadata extraction failed", { error });
            return {
                actors: [],
                verbatim_statements: [],
                summary: "Extraction failed",
                events: [],
                time: "Unknown"
            };
        }
    }
};
