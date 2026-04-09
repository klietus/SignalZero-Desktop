import OpenAI from "openai";
import { domainService } from "./domainService.js";
import { embedText } from "./embeddingService.js";
import { settingsService } from "./settingsService.js";
import { getGeminiClient, extractJson } from "./inferenceService.js";

interface DomainDescriptor {
    id: string;
    name: string;
    description: string;
    invariants: string[];
}

interface SimilarDomain extends DomainDescriptor {
    similarity: number;
}

const getClient = async () => {
    const { endpoint, apiKey } = await settingsService.getInferenceSettings();
    return new OpenAI({ baseURL: endpoint, apiKey: apiKey || 'local' });
};

const cosineSimilarity = (a: number[], b: number[]): number => {
    if (!a.length || !b.length || a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return (normA === 0 || normB === 0) ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

const buildDescriptor = (id: string, name: string, description?: string, invariants?: string[]): DomainDescriptor => ({
    id, name: name || id, description: description || "", invariants: invariants || [],
});

const findClosestDomains = async (
    targetText: string,
    domains: DomainDescriptor[],
    excludeIds: Set<string>,
    limit: number = 2
): Promise<SimilarDomain[]> => {
    const targetEmbedding = await embedText(targetText);
    const scored = await Promise.all(domains.map(async (domain) => {
        const descriptorText = `${domain.name} ${domain.description} ${(domain.invariants || []).join(' ')}`;
        const embedding = await embedText(descriptorText);
        return { ...domain, similarity: cosineSimilarity(targetEmbedding, embedding) };
    }));
    return scored
        .filter((domain) => !excludeIds.has(domain.id))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
};

export const domainInferenceService = {
    async inferInvariants(domainId: string, description: string, displayName?: string) {
        const metadata = await domainService.getMetadata();
        const domainMap: Record<string, DomainDescriptor> = {};
        metadata.forEach((d) => domainMap[d.id] = buildDescriptor(d.id, d.name, d.description, d.invariants));

        const rootDomain = domainMap['root'] || buildDescriptor('root', 'root');
        const availableDomains = Object.values(domainMap);
        const targetText = `${displayName || domainId} ${description}`;
        const closest = await findClosestDomains(targetText, availableDomains, new Set(['root', domainId]));
        const contextualDomains: SimilarDomain[] = [];
        if (rootDomain) contextualDomains.push({ ...rootDomain, similarity: 1 });
        contextualDomains.push(...closest);

        const prompt = `You are the SignalZero domain architect. Infer the invariant constraints for a brand new domain.
NEW DOMAIN ID: ${domainId}
DISPLAY NAME: ${displayName || domainId}
DESCRIPTION: ${description}
ROOT DOMAIN INVARIANTS: ${(rootDomain.invariants || []).join('; ') || 'None recorded'}
CLOSEST DOMAINS: ${closest.map(d => `- ${d.id}: ${d.invariants.join('; ')}`).join('\n')}
Return JSON with field "invariants" (concise statements).`;

        const { provider, model } = await settingsService.getInferenceSettings();
        let parsed: any = {};

        if (provider === 'gemini') {
            const genAI = await getGeminiClient();
            const genModel = genAI.getGenerativeModel({ model });
            const result = await genModel.generateContent(prompt);
            parsed = extractJson(result.response.text());
        } else {
            const client = await getClient();
            const result = await client.chat.completions.create({
                model,
                messages: [{ role: 'user', content: prompt }]
            });
            parsed = extractJson(result.choices[0]?.message?.content || "{}");
        }

        return {
            invariants: (parsed.invariants || []) as string[],
            reasoning: parsed.reasoning,
            context: contextualDomains,
        };
    },

    async createDomainWithInference(domainId: string, description: string, displayName?: string) {
        const exists = await domainService.hasDomain(domainId);
        if (exists) throw new Error(`Domain '${domainId}' already exists.`);
        const inference = await this.inferInvariants(domainId, description, displayName);
        const created = await domainService.createDomain(domainId, {
            name: displayName || domainId, description, invariants: inference.invariants,
        });
        return {
            domain: created,
            inferred_from: inference.context.map((c) => ({ id: c.id, similarity: c.similarity, invariants: c.invariants })),
            reasoning: inference.reasoning,
        };
    }
};
