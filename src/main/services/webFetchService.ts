import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { extractJson, callFastInference } from './inferenceService.js';
import { loggerService, LogCategory } from './loggerService.js';
import { documentMeaningService } from './documentMeaningService.js';

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
        imageDescription?: string;
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
            
            const resolveUrl = (src: string | null | undefined) => {
                if (!src) return null;
                try {
                    // Use the document's baseURI or the original URL
                    const resolved = new URL(src, doc.baseURI || url).href;
                    loggerService.catDebug(LogCategory.TOOL, `WebFetchService: Resolved image URL "${src}" to "${resolved}"`);
                    return resolved;
                } catch (e) {
                    loggerService.catWarn(LogCategory.TOOL, `WebFetchService: Failed to resolve image URL "${src}" against base "${doc.baseURI || url}"`);
                    return null;
                }
            };

            // 1. OG/Twitter Meta Tags
            const og = resolveUrl(doc.querySelector('meta[property="og:image"]')?.getAttribute('content'));
            if (og) imageCandidates.push(og);
            const twitter = resolveUrl(doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content'));
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
                const resolved = resolveUrl(src);
                if (resolved && !imageCandidates.includes(resolved)) {
                    imageCandidates.push(resolved);
                }
            }

            // --- VISION ANALYSIS (Describe the best candidate) ---
            let imageDescription = "";
            let selectedImageUrl = "";
            
            if (imageCandidates.length > 0) {
                selectedImageUrl = imageCandidates[0];
                try {
                    loggerService.catDebug(LogCategory.TOOL, `WebFetchService: Describing hero image: ${selectedImageUrl}`);
                    const imgResp = await fetch(selectedImageUrl, { signal: AbortSignal.timeout(10000) });
                    if (imgResp.ok) {
                        const buffer = await imgResp.arrayBuffer();
                        const contentType = imgResp.headers.get('content-type') || 'image/jpeg';
                        const meaning = await documentMeaningService.parse(Buffer.from(buffer), contentType, selectedImageUrl);
                        if (meaning.type === 'image' && meaning.content && !meaning.content.includes('[Image analysis failed]')) {
                            imageDescription = meaning.content;
                            loggerService.catDebug(LogCategory.TOOL, "WebFetchService: Image description generated successfully");
                        } else if (meaning.content?.includes('[Image analysis failed]')) {
                            loggerService.catWarn(LogCategory.TOOL, `WebFetchService: Image analysis failed: ${meaning.content}`);
                        }
                    } else {
                        loggerService.catWarn(LogCategory.TOOL, `WebFetchService: Hero image fetch failed with status ${imgResp.status} ${imgResp.statusText}`);
                    }
                } catch (imgErr: any) {
                    loggerService.catWarn(LogCategory.TOOL, "WebFetchService: Failed to describe hero image", { 
                        imageUrl: selectedImageUrl,
                        error: imgErr.message || String(imgErr) 
                    });
                }
            }

            const cleanText = article.textContent.trim().replace(/\s+/g, ' ');
            const metadata = await this.extractMetadata(cleanText, url, selectedImageUrl, imageDescription);

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

    async extractMetadata(text: string, url: string, imageUrl: string = "", imageDescription: string = ""): Promise<any> {
        const prompt = `Analyze the following text from ${url} and extract structured information.
        
        TEXT:
        ${text.slice(0, 10000)}

        HERO IMAGE URL: ${imageUrl || "None"}
        HERO IMAGE VISUAL DESCRIPTION: 
        ${imageDescription || "No description available."}

        Return ONLY valid JSON matching this schema. 
        CRITICAL: All double quotes INSIDE string values must be properly escaped with backslashes.
        
        {
            "actors": ["List of primary entities/people involved"],
            "verbatim_statements": ["Key direct quotes or specific declarations"],
            "summary": "Concise summary of the core information. Incorporate relevant visual details if an image description was provided.",
            "events": ["Timeline of specific events mentioned"],
            "time": "The primary timeframe of the content",
            "imageUrl": "The provided Hero Image URL if relevant, else null.",
            "imageDescription": "The provided Visual Description if relevant, else null."
        }`;

        try {
            const fastText = await callFastInference([{ role: "user", content: prompt }], 4096);
            const response = await extractJson(fastText);
            return response;
        } catch (error) {
            loggerService.catError(LogCategory.TOOL, "WebFetchService: Metadata extraction failed", { error });
            return {
                actors: [],
                verbatim_statements: [],
                summary: "Extraction failed",
                events: [],
                time: "Unknown",
                imageUrl: imageUrl || null,
                imageDescription: imageDescription || null
            };
        }
    }
};
