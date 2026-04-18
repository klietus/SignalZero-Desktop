import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import Parser from 'rss-parser';
import pdf from 'pdf-parse';
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { loggerService } from './loggerService.js';
import { settingsService } from './settingsService.js';
import { sqliteService } from './sqliteService.js';
import crypto from 'crypto';

export interface NormalizedDocument {
    type: 'html' | 'rss' | 'pdf' | 'text' | 'json' | 'image' | 'unknown';
    metadata: {
        title?: string;
        description?: string;
        author?: string;
        publishedDate?: string;
        url?: string;
        [key: string]: any;
    };
    content: string;
    structured_data?: any;
}

class DocumentMeaningService {
    private rssParser: Parser;

    constructor() {
        this.rssParser = new Parser();
    }

    async parse(content: Buffer | string, contentType: string, url?: string): Promise<NormalizedDocument> {
        const type = this.detectType(contentType, url, content);
        
        loggerService.info(`DocumentMeaningService: Detected type ${type} for ${url}`);

        try {
            switch (type) {
                case 'rss':
                    return await this.parseRss(content.toString());
                case 'pdf':
                    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
                    return await this.parsePdf(buffer);
                case 'html':
                    return this.parseHtml(content.toString());
                case 'json':
                     return this.parseJson(content.toString());
                case 'image':
                    const imgBuffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
                    return await this.extractImageMeaning(imgBuffer, contentType, url);
                default:
                    return {
                        type: 'text',
                        metadata: { url },
                        content: content.toString()
                    };
            }
        } catch (error) {
            loggerService.error('DocumentMeaningService: Parsing failed', { type, url, error });
            return {
                type: 'unknown',
                metadata: { url, error: String(error) },
                content: content.toString().slice(0, 1000)
            };
        }
    }

    private detectType(contentType: string, url: string | undefined, content: Buffer | string): 'html' | 'rss' | 'pdf' | 'json' | 'image' | 'text' {
        const lowerType = contentType?.toLowerCase() || '';
        const lowerUrl = url?.toLowerCase() || '';
        const contentStr = content.toString();

        if (lowerType.startsWith('image/') || lowerUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
            return 'image';
        }

        if (lowerType.includes('application/rss+xml') || lowerType.includes('application/atom+xml') || lowerType.includes('application/xml') || lowerType.includes('text/xml')) {
            if (contentStr.includes('<rss') || contentStr.includes('<feed') || contentStr.includes('<channel>')) {
                return 'rss';
            }
        }
        
        if (lowerType.includes('pdf') || lowerUrl.endsWith('.pdf')) {
            return 'pdf';
        }

        if (lowerType.includes('html')) {
            return 'html';
        }

        if (lowerType.includes('json')) {
            return 'json';
        }

        return 'text';
    }

    private async parseRss(content: string): Promise<NormalizedDocument> {
        const feed = await this.rssParser.parseString(content);
        return {
            type: 'rss',
            metadata: {
                title: feed.title,
                description: feed.description,
                url: feed.link,
                language: feed.language
            },
            content: feed.items.map(item => {
                const title = item.title ? `Title: ${item.title}` : '';
                const snippet = item.contentSnippet ? `\nSummary: ${item.contentSnippet}` : '';
                const link = item.link ? `\nLink: ${item.link}` : '';
                return `${title}${snippet}${link}`;
            }).join('\n\n---\n\n'),
            structured_data: feed.items
        };
    }

    private async parsePdf(content: Buffer): Promise<NormalizedDocument> {
        const data = await pdf(content);
        return {
            type: 'pdf',
            metadata: {
                pages: data.numpages,
                info: data.info
            },
            content: data.text
        };
    }

    private parseHtml(content: string): NormalizedDocument {
        const dom = new JSDOM(content);
        const doc = dom.window.document;
        const images: { url: string; title: string }[] = [];
        doc.querySelectorAll('img').forEach((el) => {
            const src = el.getAttribute('src');
            const alt = el.getAttribute('alt') || el.getAttribute('title') || '';
            if (src) images.push({ url: src, title: alt.trim() });
        });

        const reader = new Readability(doc);
        const article = reader.parse();
        const mainText = article?.textContent ? article.textContent.replace(/\s+/g, ' ').trim() : '';

        return {
            type: 'html',
            metadata: {
                title: article?.title || doc.title || '',
                description: article?.excerpt || '',
                image_count: images.length,
                byline: article?.byline,
                siteName: article?.siteName,
                lang: article?.lang
            },
            content: mainText,
            structured_data: { images }
        };
    }

    private parseJson(content: string): NormalizedDocument {
         try {
            const parsed = JSON.parse(content);
            return {
                type: 'json',
                metadata: {},
                content: JSON.stringify(parsed, null, 2),
                structured_data: parsed
            }
         } catch(e) {
             return { type: 'text', metadata: { error: 'Invalid JSON'}, content };
         }
    }

    private async extractImageMeaning(buffer: Buffer, contentType: string, url?: string): Promise<NormalizedDocument> {
        const settings = await settingsService.getInferenceSettings();
        const apiKey = settings.apiKey;
        let visionModel = settings.visionModel;

        if (settings.provider === 'gemini') {
            visionModel = visionModel || 'gemini-2.5-flash';
        } else {
            visionModel = visionModel || 'gpt-4o-mini';
        }

        // --- CACHE CHECK ---
        const hash = crypto.createHash('sha256').update(buffer).digest('hex');
        try {
            const cached = sqliteService.get(`SELECT * FROM media_cache WHERE hash = ?`, [hash]);
            if (cached) {
                loggerService.info(`DocumentMeaningService: Cache hit for image ${hash.substring(0, 8)}`);
                const cachedMetadata = cached.metadata ? JSON.parse(cached.metadata) : {};
                return {
                    type: 'image',
                    metadata: { 
                        url, 
                        model: cachedMetadata.model || visionModel,
                        base64: buffer.toString('base64'),
                        mimeType: contentType || 'image/jpeg',
                        cached: true
                    },
                    content: cached.content,
                    structured_data: { analysis_model: cachedMetadata.model || visionModel, cache_hit: true }
                };
            }
        } catch (e) {
            loggerService.error(`DocumentMeaningService: Cache check failed`, { error: e });
        }

        if (!apiKey && (settings.provider === 'openai' || settings.provider === 'gemini')) {
             return {
                type: 'image',
                metadata: { url, error: "No API Key configured" },
                content: `[Image content cannot be analyzed: Missing API Key]`
            };
        }

        try {
            let description = "No description generated.";
            if (settings.provider === 'gemini') {
                const client = new GoogleGenerativeAI(apiKey);
                const model = client.getGenerativeModel({ model: visionModel });
                const result = await model.generateContent([
                    "Analyze this image. Describe the setting, identify key objects, and explain the relationships.",
                    { inlineData: { data: buffer.toString('base64'), mimeType: contentType || 'image/jpeg' } }
                ]);
                description = result.response.text();
            } else {
                const client = new OpenAI({ 
                    apiKey: apiKey || 'local', 
                    baseURL: settings.provider === 'local' ? settings.endpoint : undefined 
                });
                const response = await client.chat.completions.create({
                    model: visionModel,
                    messages: [
                        {
                            role: "user",
                            content: [
                                { type: "text", text: "Analyze this image." },
                                { type: "image_url", image_url: { url: `data:${contentType || 'image/jpeg'};base64,${buffer.toString('base64')}` } }
                            ]
                        }
                    ],
                    max_tokens: 1024
                } as any);
                description = response.choices[0]?.message?.content || "";
            }

            const cleanDescription = this.stripThinking(description);

            // --- CACHE SAVE ---
            try {
                sqliteService.run(
                    `INSERT OR REPLACE INTO media_cache (hash, content, metadata) VALUES (?, ?, ?)`,
                    [hash, cleanDescription, JSON.stringify({ model: visionModel, contentType })]
                );
                loggerService.info(`DocumentMeaningService: Cached description for image ${hash.substring(0, 8)}`);
            } catch (e) {
                loggerService.error(`DocumentMeaningService: Cache save failed`, { error: e });
            }

            return {
                type: 'image',
                metadata: { 
                    url, 
                    model: visionModel,
                    base64: buffer.toString('base64'),
                    mimeType: contentType || 'image/jpeg'
                },
                content: cleanDescription,
                structured_data: { analysis_model: visionModel }
            };
        } catch (error: any) {
            loggerService.error(`DocumentMeaningService: Image analysis failed for ${url}`, { error: error.message });
            return { type: 'image', metadata: { url, error: String(error) }, content: `[Image analysis failed: ${error.message || String(error)}]` };
        }
    }

    private stripThinking(text: string): string {
        return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    }
}

export const documentMeaningService = new DocumentMeaningService();
