import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
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
        imageUrl?: string;
    };
}

export const webFetchService = {
    async fetch(url: string): Promise<WebFetchResult | null> {
        loggerService.catInfo(LogCategory.TOOL, `WebFetchService: Fetching and extracting from ${url}`);
        
        try {
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
            const doc = dom.window.document;

            // --- IMAGE EXTRACTION (Efficient, single-pass) ---
            const imageCandidates: string[] = [];
            
            // 1. OG/Twitter Meta Tags
            const og = doc.querySelector('meta[property="og:image"]')?.getAttribute('content');
            if (og) imageCandidates.push(og);
            const twitter = doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content');
            if (twitter) imageCandidates.push(twitter);

            // 2. Readability parsing
            const reader = new Readability(doc);
            const article = reader.parse();

            if (!article || !article.textContent) {
                throw new Error("Failed to parse article content from HTML");
            }

            // 3. Fallback heuristic: First large image in article or main
            const mainImg = doc.querySelector('article img, main img, #content img');
            if (mainImg) {
                const src = mainImg.getAttribute('src');
                if (src && (src.startsWith('http') || src.startsWith('//'))) {
                    const finalSrc = src.startsWith('//') ? `https:${src}` : src;
                    if (!imageCandidates.includes(finalSrc)) imageCandidates.push(finalSrc);
                }
            }

            const cleanText = article.textContent.trim().replace(/\s+/g, ' ');
            const metadata = await this.extractMetadata(cleanText, url, imageCandidates);

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

    async extractMetadata(text: string, url: string, imageCandidates: string[] = []): Promise<any> {
        const settings = await settingsService.getInferenceSettings();
        const fastModel = settings.fastModel;
        if (!fastModel) throw new Error("Fast model not configured");

        const prompt = `Analyze the following text from ${url} and extract structured information.
        
        TEXT:
        ${text.slice(0, 10000)}

        IMAGE CANDIDATES FOUND IN HTML:
        ${imageCandidates.join('\n')}

        Return ONLY valid JSON matching this schema. 
        CRITICAL: All double quotes INSIDE string values must be properly escaped with backslashes.
        
        {
            "actors": ["List of primary entities/people involved"],
            "verbatim_statements": ["Key direct quotes or specific declarations"],
            "summary": "Concise summary of the core information",
            "events": ["Timeline of specific events mentioned"],
            "time": "The primary timeframe of the content",
            "imageUrl": "The most relevant hero/primary image URL from the candidates provided above. If none are relevant, leave null."
        }`;

        try {
            let response: any = {};
            if (settings.provider === 'gemini') {
                const client = await getGeminiClient();
                const model = client.getGenerativeModel({ model: fastModel });
                const result = await model.generateContent(prompt);
                response = extractJson(result.response.text());
            } else {
                const client = await getClient();
                const result = await client.chat.completions.create({
                    model: fastModel,
                    messages: [{ role: "user", content: prompt }]
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
                time: "Unknown",
                imageUrl: imageCandidates[0] || null
            };
        }
    }
};
