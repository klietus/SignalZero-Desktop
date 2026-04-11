import { domainService, RECIPROCAL_MAP } from './domainService.js';
import { tentativeLinkService } from './tentativeLinkService.js';
import { sqliteService } from './sqliteService.js';
import { loggerService, LogCategory } from './loggerService.js';
import { settingsService } from './settingsService.js';
import { getClient, getGeminiClient, extractJson } from './inferenceService.js';
import { eventBusService, KernelEventType } from './eventBusService.js';
import { SymbolDef, GraphHygieneSettings } from '../types.js';
import { embedTexts } from './embeddingService.js';

export interface TopologyStats {
    symbolCount: number;
    linkCount: number;
    linkTypes: string[];
    reconstructionError: number;
    newLinksPredicted: number;
    redundantSymbolsFound: number;
    linksRefactored: number;
    reflexiveLinksCreated: number;
    islandsBridged: number;
    domainLatticeLinksCreated: number;
    crossDomainBridgesLifted: number;
}

interface PredictedLink {
    sourceId: string;
    targetId: string;
    linkType: string;
    confidence: number;
}

class TopologyService {
    private readonly CONFIDENCE_THRESHOLD = 0.85;
    private readonly REDUNDANCY_THRESHOLD = 0.98;
    private isAnalyzing = false;
    private lastRunTimestamp: string | null = null;
    private mergeAttemptCache: Map<string, string> = new Map();
    private linkPromotionCache: Map<string, string> = new Map();

    constructor() { }

    private getGroupKey(symbols: SymbolDef[]): string {
        return symbols.map(s => s.id).sort().join(',');
    }

    private getGroupTimestampKey(symbols: SymbolDef[]): string {
        return symbols.map(s => s.updated_at || '').sort().join(',');
    }

    /**
     * Executes the global topology analysis loop.
     * If specificStrategy is provided, it runs only that one.
     * If overrideSettings is provided, it uses those instead of saved settings.
     */
    async analyze(specificStrategy?: string, overrideSettings?: GraphHygieneSettings): Promise<TopologyStats | null> {
        if (this.isAnalyzing) {
            loggerService.catWarn(LogCategory.KERNEL, "TopologyService: Analysis already in progress, skipping request");
            return null;
        }

        try {
            this.isAnalyzing = true;
            const hygiene = overrideSettings || await settingsService.getHygieneSettings();
            const currentRunTimestamp = new Date().toISOString();

            loggerService.catInfo(LogCategory.KERNEL, "TopologyService: Starting topology analysis", {
                strategy: specificStrategy || 'full',
                hygiene,
                isOverride: !!overrideSettings,
                lastRun: this.lastRunTimestamp
            });

            // 1. Fetch all symbols
            const allDomains = await domainService.listDomains();
            const symbols: SymbolDef[] = [];
            for (const dId of allDomains) {
                const domainSymbols = await domainService.getSymbols(dId);
                symbols.push(...domainSymbols);
            }

            if (symbols.length === 0) {
                loggerService.catInfo(LogCategory.KERNEL, "TopologyService: No symbols found for analysis");
                return null;
            }

            // Calculate global link stats
            const linkTypes = new Set<string>();
            let linkCount = 0;
            symbols.forEach(s => {
                (s.linked_patterns || []).forEach(l => {
                    linkTypes.add(l.link_type || 'emergent');
                    linkCount++;
                });
            });

            let newLinksPredicted = 0;
            let redundantSymbolsFound = 0;
            let linksRefactored = 0;
            let reflexiveLinksCreated = 0;
            let islandsBridged = 0;
            let domainLatticeLinksCreated = 0;
            let crossDomainBridgesLifted = 0;

            // Relational analysis requires at least 2 symbols
            const canRunRelational = symbols.length >= 2;
            const idToSymbol = new Map<string, SymbolDef>(symbols.map(s => [s.id, s]));

            // --- STRATEGY: Link Type Refactoring ---
            if (canRunRelational && (specificStrategy === 'refactor' || (specificStrategy === undefined && hygiene.refactorLinks))) {
                linksRefactored = await this.refactorLinksToCanonical(symbols);
            }

            // --- STRATEGY: Instantiate Missing Reflexive Links ---
            if (canRunRelational && (specificStrategy === 'reflexive' || (specificStrategy === undefined && hygiene.reflexiveLinks))) {
                reflexiveLinksCreated = await this.instantiateMissingReflexiveLinks(symbols);
            }

            // --- STRATEGY: Bridge Isolated Subgraphs ---
            if (canRunRelational && (specificStrategy === 'bridge' || (specificStrategy === undefined && hygiene.bridgeIslands))) {
                islandsBridged = await this.bridgeIsolatedSubgraphs(symbols);
            }

            // --- STRATEGY: Domain Lattice Refactoring ---
            if (canRunRelational && (specificStrategy === 'domainRefactor' || (specificStrategy === undefined && hygiene.domainRefactor))) {
                domainLatticeLinksCreated = await this.refactorDomainLattices(symbols);
            }

            // --- STRATEGY: Cross-Domain Bridge Lifting ---
            if (canRunRelational && (specificStrategy === 'bridgeLifting' || (specificStrategy === undefined && hygiene.bridgeLifting))) {
                crossDomainBridgesLifted = await this.refactorCrossDomainBridges(symbols);
            }

            // --- STRATEGY: Dead Link Cleanup ---
            if (specificStrategy === 'deadLinkCleanup' || (specificStrategy === undefined && hygiene.deadLinkCleanup)) {
                await this.cleanupDeadLinks();
            }

            // --- STRATEGY: Semantic (Vector) Analysis ---
            if (canRunRelational && (specificStrategy === 'semantic' || (specificStrategy === undefined && (hygiene.semantic.autoCompress || hygiene.semantic.autoLink)))) {
                const semanticResults = await this.runSemanticAnalysis(symbols, hygiene, this.lastRunTimestamp, idToSymbol);
                newLinksPredicted += semanticResults.newLinks;
                redundantSymbolsFound += semanticResults.redundantCount;
            }

            // --- STRATEGY: Triadic Analysis ---
            if (canRunRelational && (specificStrategy === 'triadic' || (specificStrategy === undefined && (hygiene.triadic.autoCompress || hygiene.triadic.autoLink)))) {
                const triadicResults = await this.runTriadicAnalysis(symbols, hygiene, idToSymbol);
                newLinksPredicted += triadicResults.newLinks;
                redundantSymbolsFound += triadicResults.redundantCount;
            }

            // --- STRATEGY: Link Promotion ---
            if (canRunRelational && (specificStrategy === 'promotion' || (specificStrategy === undefined && hygiene.linkPromotion))) {
                await this.promoteRelatesToLinks(symbols);
            }

            // 4. Recalculate final stats (post-cleanup)
            const finalLinkTypes = new Set<string>();
            let finalLinkCount = 0;
            symbols.forEach(s => {
                (s.linked_patterns || []).forEach(l => {
                    finalLinkTypes.add(l.link_type || 'relates_to');
                    finalLinkCount++;
                });
            });

            const stats: TopologyStats = {
                symbolCount: symbols.length,
                linkCount: finalLinkCount,
                linkTypes: Array.from(finalLinkTypes),
                reconstructionError: 0,
                newLinksPredicted,
                redundantSymbolsFound,
                linksRefactored,
                reflexiveLinksCreated,
                islandsBridged,
                domainLatticeLinksCreated,
                crossDomainBridgesLifted
            };

            this.lastRunTimestamp = currentRunTimestamp;
            loggerService.catInfo(LogCategory.KERNEL, "TopologyService: Analysis complete", stats);
            return stats;

        } catch (error: any) {
            loggerService.catError(LogCategory.KERNEL, "TopologyService: Analysis failed", {
                error: error?.message || String(error),
                stack: error?.stack
            });
            return null;
        } finally {
            this.isAnalyzing = false;
        }
    }

    private async runSemanticAnalysis(symbols: SymbolDef[], hygiene: GraphHygieneSettings, lastRun: string | null, idToSymbol: Map<string, SymbolDef>) {
        loggerService.catInfo(LogCategory.KERNEL, "TopologyService: Starting semantic analysis", { symbolCount: symbols.length });
        let newLinksCount = 0;
        let redundantCount = 0;

        // Check for updates helper
        const wasUpdated = (s: SymbolDef): boolean => {
            if (!lastRun || !s.updated_at) return true;
            return new Date(s.updated_at) > new Date(lastRun);
        };

        const texts = symbols.map(s => `${s.name}: ${s.role}`);

        let embeddings: number[][] = [];
        try {
            embeddings = await embedTexts(texts);
        } catch (embErr: any) {
            loggerService.catError(LogCategory.KERNEL, "TopologyService: Semantic analysis failed at embedding stage", {
                error: embErr.message || String(embErr),
                symbolCount: symbols.length
            });
            return { newLinks: 0, redundantCount: 0 };
        }

        const N = symbols.length;
        if (embeddings.length !== N) {
            loggerService.catError(LogCategory.KERNEL, "TopologyService: Embedding count mismatch", {
                expected: N,
                received: embeddings.length
            });
            return { newLinks: 0, redundantCount: 0 };
        }

        // Helper to yield to event loop
        const yieldToEventLoop = () => new Promise(resolve => setImmediate(resolve));

        // Normalize all embeddings first for cosine similarity
        const normalizedEmbeddings: number[][] = [];
        try {
            for (let i = 0; i < N; i++) {
                const emb = embeddings[i];
                if (!emb || emb.length === 0) {
                    normalizedEmbeddings.push([]);
                    continue;
                }
                const norm = Math.sqrt(emb.reduce((sum, val) => sum + val * val, 0));
                normalizedEmbeddings.push(emb.map(val => val / (norm + 1e-9)));

                if (i % 500 === 0) await yieldToEventLoop();
            }
        } catch (normErr: any) {
            loggerService.catError(LogCategory.KERNEL, "TopologyService: Embedding normalization failed", { error: normErr.message });
            return { newLinks: 0, redundantCount: 0 };
        }

        const computeSimilarity = (v1: number[], v2: number[]) => {
            if (v1.length === 0 || v2.length === 0 || v1.length !== v2.length) return 0;
            return v1.reduce((sum, val, idx) => sum + val * v2[idx], 0);
        };

        if (hygiene.semantic.autoCompress) {
            loggerService.catInfo(LogCategory.KERNEL, "TopologyService: Checking for semantic redundancy");
            const redundantGroups: SymbolDef[][] = [];
            const visited = new Set<number>();

            try {
                let iterations = 0;
                for (let i = 0; i < N; i++) {
                    if (visited.has(i) || normalizedEmbeddings[i].length === 0) continue;

                    const group = [symbols[i]];
                    for (let j = i + 1; j < N; j++) {
                        if (visited.has(j) || normalizedEmbeddings[j].length === 0) continue;

                        const sim = computeSimilarity(normalizedEmbeddings[i], normalizedEmbeddings[j]);
                        if (sim > this.REDUNDANCY_THRESHOLD) {
                            // Only proceed if one of them has changed since last run
                            if (wasUpdated(symbols[i]) || wasUpdated(symbols[j])) {
                                group.push(symbols[j]);
                                visited.add(j);
                            }
                        }

                        iterations++;
                        if (iterations % 5000 === 0) await yieldToEventLoop();
                    }
                    if (group.length > 1) {
                        redundantGroups.push(group);
                        visited.add(i);
                    }
                }
            } catch (compErr: any) {
                loggerService.catError(LogCategory.KERNEL, "TopologyService: Semantic redundancy check failed", { error: compErr.message });
            }

            if (redundantGroups.length > 0) {
                loggerService.catInfo(LogCategory.KERNEL, `TopologyService: Merging ${redundantGroups.length} potential redundant groups`);
                try {
                    await this.mergeRedundantSymbols(redundantGroups);
                    redundantCount = redundantGroups.reduce((acc, g) => acc + g.length - 1, 0);
                } catch (mergeErr: any) {
                    loggerService.catError(LogCategory.KERNEL, "TopologyService: Symbol merge failed", { error: mergeErr.message });
                }
            }
        }

        if (hygiene.semantic.autoLink) {
            loggerService.catInfo(LogCategory.KERNEL, "TopologyService: Checking for semantic link opportunities");
            const predicted: PredictedLink[] = [];
            try {
                let iterations = 0;
                for (let i = 0; i < N; i++) {
                    if (normalizedEmbeddings[i].length === 0) continue;

                    for (let j = i + 1; j < N; j++) {
                        if (normalizedEmbeddings[j].length === 0) continue;

                        const sim = computeSimilarity(normalizedEmbeddings[i], normalizedEmbeddings[j]);
                        // Use a slightly lower threshold for potential links than for redundancy
                        if (sim > this.CONFIDENCE_THRESHOLD && sim <= this.REDUNDANCY_THRESHOLD) {
                            // Only proceed if one of them has changed since last run
                            if (wasUpdated(symbols[i]) || wasUpdated(symbols[j])) {
                                const hasLink = symbols[i].linked_patterns?.some(l => (typeof l === 'string' ? l : l.id) === symbols[j].id) ||
                                    symbols[j].linked_patterns?.some(l => (typeof l === 'string' ? l : l.id) === symbols[i].id);

                                if (!hasLink) {
                                    // NO LINK if already reachable in < 3 hops
                                    const distance = this.getShortestPathDistance(symbols[i].id, symbols[j].id, idToSymbol);
                                    if (distance < 3) {
                                        iterations++;
                                        continue;
                                    }

                                    // LLM Validation for link
                                    try {
                                        const validation = await this.validateLink(symbols[i], symbols[j]);
                                        if (validation.shouldLink) {
                                            predicted.push({
                                                sourceId: symbols[i].id,
                                                targetId: symbols[j].id,
                                                linkType: validation.linkType || 'semantic_inference',
                                                confidence: sim
                                            });
                                        }
                                    } catch (valErr: any) {
                                        loggerService.catError(LogCategory.KERNEL, "TopologyService: Link validation failed for pair", {
                                            s1: symbols[i].id,
                                            s2: symbols[j].id,
                                            error: valErr.message
                                        });
                                    }
                                }
                            }
                        }

                        iterations++;
                        if (iterations % 5000 === 0) await yieldToEventLoop();
                    }
                }
            } catch (linkErr: any) {
                loggerService.catError(LogCategory.KERNEL, "TopologyService: Semantic auto-link check failed", { error: linkErr.message });
            }

            if (predicted.length > 0) {
                try {
                    await this.promoteToTentative(predicted);
                    newLinksCount = predicted.length;
                } catch (promoErr: any) {
                    loggerService.catError(LogCategory.KERNEL, "TopologyService: Failed to promote links", { error: promoErr.message });
                }
            }
        }

        return { newLinks: newLinksCount, redundantCount };
    }

    private async runTriadicAnalysis(symbols: SymbolDef[], hygiene: GraphHygieneSettings, idToSymbol: Map<string, SymbolDef>) {
        loggerService.catInfo(LogCategory.KERNEL, "TopologyService: Starting triadic analysis", { symbolCount: symbols.length });
        let redundantCount = 0;
        let newLinksCount = 0;

        if (hygiene.triadic.autoCompress) {
            const triadicGroups = new Map<string, SymbolDef[]>();
            symbols.forEach(s => {
                if (!s.triad) return;
                const existing = triadicGroups.get(s.triad) || [];
                existing.push(s);
                triadicGroups.set(s.triad, existing);
            });

            const redundantGroups = Array.from(triadicGroups.values()).filter(g => g.length > 1);

            if (redundantGroups.length > 0) {
                await this.mergeRedundantSymbols(redundantGroups);
                redundantCount = redundantGroups.reduce((acc, g) => acc + g.length - 1, 0);
            }
        }

        if (hygiene.triadic.autoLink) {
            const predicted: PredictedLink[] = [];
            for (let i = 0; i < symbols.length; i++) {
                const triadI = symbols[i].triad;
                if (!triadI) continue;

                for (let j = i + 1; j < symbols.length; j++) {
                    const triadJ = symbols[j].triad;
                    if (triadI === triadJ) {
                        const hasLink = symbols[i].linked_patterns?.some(l => (typeof l === 'string' ? l : l.id) === symbols[j].id) ||
                            symbols[j].linked_patterns?.some(l => (typeof l === 'string' ? l : l.id) === symbols[i].id);

                        if (!hasLink) {
                            // NO LINK if already reachable in < 3 hops
                            const distance = this.getShortestPathDistance(symbols[i].id, symbols[j].id, idToSymbol);
                            if (distance < 3) continue;

                            predicted.push({
                                sourceId: symbols[i].id,
                                targetId: symbols[j].id,
                                linkType: 'triadic_resonance',
                                confidence: 1.0
                            });
                        }
                    }
                }
            }
            if (predicted.length > 0) {
                await this.promoteToTentative(predicted);
                newLinksCount = predicted.length;
            }
        }

        return { newLinks: newLinksCount, redundantCount };
    }

    private async cleanupDeadLinks() {
        loggerService.catInfo(LogCategory.KERNEL, "TopologyService: Starting dead link cleanup");

        try {
            // 1. Delete links where target doesn't exist
            const resultTarget = sqliteService.run(`
                DELETE FROM symbol_links 
                WHERE target_id NOT IN (SELECT id FROM symbols)
            `);

            // 2. Delete links where source doesn't exist
            const resultSource = sqliteService.run(`
                DELETE FROM symbol_links 
                WHERE source_id NOT IN (SELECT id FROM symbols)
            `);

            // 3. Delete self-links (source_id = target_id)
            const resultSelf = sqliteService.run(`
                DELETE FROM symbol_links 
                WHERE source_id = target_id
            `);

            const totalDeleted = (resultTarget.changes || 0) + (resultSource.changes || 0) + (resultSelf.changes || 0);
            if (totalDeleted > 0) {
                loggerService.catInfo(LogCategory.KERNEL, `TopologyService: Cleaned up ${totalDeleted} dead or self-links globally`);
            }
        } catch (error) {
            loggerService.catError(LogCategory.KERNEL, "TopologyService: Global dead link cleanup failed", { error });
        }
    }

    private async promoteRelatesToLinks(symbols: SymbolDef[]) {
        loggerService.catInfo(LogCategory.KERNEL, "TopologyService: Starting link promotion analysis");
        const idToSymbol = new Map<string, SymbolDef>();
        symbols.forEach(s => idToSymbol.set(s.id, s));
        const canonicalTypes = new Set(Object.keys(RECIPROCAL_MAP));

        for (const s of symbols) {
            if (!s.linked_patterns) continue;

            let updated = false;
            for (const link of s.linked_patterns) {
                if (link.link_type === 'relates_to') {
                    const target = idToSymbol.get(link.id);
                    if (target) {
                        const promotionKey = `${s.id}:${target.id}`;
                        const timestampKey = `${s.updated_at || ''}:${target.updated_at || ''}`;

                        if (this.linkPromotionCache.get(promotionKey) === timestampKey) {
                            continue; // Skip - already tried this pair with these versions
                        }

                        // Record attempt
                        this.linkPromotionCache.set(promotionKey, timestampKey);

                        const validation = await this.validateLink(s, target);
                        // Only promote if the model suggested a type AND that type is in our canonical taxonomy
                        if (validation.shouldLink && validation.linkType && validation.linkType !== 'relates_to') {
                            if (canonicalTypes.has(validation.linkType)) {
                                loggerService.catInfo(LogCategory.KERNEL, `TopologyService: Promoting link ${s.id} -> ${target.id} to ${validation.linkType}`);
                                link.link_type = validation.linkType;
                                updated = true;
                            } else {
                                loggerService.catDebug(LogCategory.KERNEL, `TopologyService: Link promotion rejected non-canonical type: ${validation.linkType}`);
                            }
                        }
                    }
                }
            }

            if (updated) {
                await domainService.addSymbol(s.symbol_domain, s);
            }
        }
    }

    private async validateLink(s1: SymbolDef, s2: SymbolDef): Promise<{ shouldLink: boolean, linkType?: string }> {
        try {
            const settings = await settingsService.getInferenceSettings();
            const fastModel = settings.fastModel;
            if (!fastModel) return { shouldLink: true, linkType: 'relates_to' };

            const prompt = `Analyze the two symbols from a symbolic knowledge graph. Determine if there is a STRONG and MEANINGFUL semantic relationship between them that justifies an automated link.
            
            Symbol 1:
            Name: ${s1.name}
            Role: ${s1.role}
            Macro: ${s1.macro}
            Triad Group: ${s1.triad || 'None'}
            Activation Conditions: ${JSON.stringify(s1.activation_conditions || [])}
            
            Symbol 2:
            Name: ${s2.name}
            Role: ${s2.role}
            Macro: ${s2.macro}
            Triad Group: ${s2.triad || 'None'}
            Activation Conditions: ${JSON.stringify(s2.activation_conditions || [])}
            
            Should these symbols be linked? Output valid JSON only.
            
            If "shouldLink" is true, you MUST choose the ONE most appropriate "linkType" from this list:
            - relates_to
            - depends_on (reciprocal: required_by)
            - required_by (reciprocal: depends_on)
            - part_of (reciprocal: contains)
            - contains (reciprocal: part_of)
            - instance_of (reciprocal: exemplifies)
            - exemplifies (reciprocal: instance_of)
            - informs (reciprocal: informed_by)
            - informed_by (reciprocal: informs)
            - constrained_by (reciprocal: limits)
            - limits (reciprocal: constrained_by)
            - triggers (reciprocal: triggered_by)
            - triggered_by (reciprocal: triggers)
            - negates (reciprocal: negated_by)
            - negated_by (reciprocal: negates)
            - evolved_from (reciprocal: evolved_into)
            - evolved_into (reciprocal: evolved_from)
            - implements (reciprocal: implemented_by)
            - implemented_by (reciprocal: implements)
            - extends (reciprocal: extended_by)
            - extended_by (reciprocal: extends)
            - synthesized_from (reciprocal: synthesis_of)
            - synthesis_of (reciprocal: synthesized_from)
            - derived_from (reciprocal: source_of)
            - source_of (reciprocal: derived_from)
            - feeds_into (reciprocal: receives_data_from)
            - receives_data_from (reciprocal: feeds_into)
            - orchestrates (reciprocal: orchestrated_by)
            - orchestrated_by (reciprocal: orchestrates)
            - monitors (reciprocal: monitored_by)
            - monitored_by (reciprocal: monitors)
            - validates (reciprocal: validated_by)
            - validated_by (reciprocal: validates)
            - enables (reciprocal: enabled_by)
            - enabled_by (reciprocal: enables)
            - executes (reciprocal: executed_by)
            - executed_by (reciprocal: executes)
            - grounds_in (reciprocal: reality_for)
            - reality_for (reciprocal: grounds_in)
            - documents (reciprocal: documented_by)
            - documented_by (reciprocal: documents)
            - contrasts_with (symmetric)
            - references (reciprocal: referenced_by)
            - referenced_by (reciprocal: references)

            {
              "shouldLink": true/false,
              "reason": "Brief explanation",
              "linkType": "chosen_link_type"
            }`;

            let resultJson: any = {};

            if (settings.provider === 'gemini') {
                const client = await getGeminiClient();
                const model = client.getGenerativeModel({
                    model: fastModel,
                    generationConfig: { maxOutputTokens: 800 }
                });
                const result = await model.generateContent(prompt);
                const response = result.response.text();
                resultJson = extractJson(response);
            } else {
                const client = await getClient();
                const result = await client.chat.completions.create({
                    model: fastModel,
                    messages: [{ role: "user", content: prompt }],
                    max_tokens: 800
                });
                const response = result.choices[0]?.message?.content || "{}";
                resultJson = extractJson(response);
            }

            return {
                shouldLink: !!resultJson.shouldLink,
                linkType: resultJson.linkType || 'relates_to'
            };
        } catch (error) {
            loggerService.catError(LogCategory.KERNEL, "TopologyService: Link validation failed", { error });
            return { shouldLink: false };
        }
    }

    private async promoteToTentative(links: { sourceId: string, targetId: string, linkType: string, confidence: number }[]) {
        loggerService.catInfo(LogCategory.KERNEL, `TopologyService: Promoting ${links.length} predicted links to tentative store`);
        for (const link of links) {
            const tracePath = [
                { symbol_id: link.sourceId },
                { symbol_id: link.targetId, link_type: link.linkType, reason: 'Topology-based automated link prediction' }
            ];
            await tentativeLinkService.processTrace(tracePath);
        }
    }

    private async selectCanonicalId(candidates: SymbolDef[]): Promise<string> {
        if (candidates.length === 0) return "";
        if (candidates.length === 1) return candidates[0].id;

        // --- CORE PRECEDENCE LOGIC ---
        // If one of the candidates has "CORE" in its ID or name, it automatically wins.
        const coreCandidates = candidates.filter(s =>
            s.id.toUpperCase().includes('CORE') ||
            s.name.toUpperCase().includes('CORE')
        );

        if (coreCandidates.length === 1) {
            loggerService.catDebug(LogCategory.KERNEL, `TopologyService: Automatic CORE precedence selected ${coreCandidates[0].id}`);
            return coreCandidates[0].id;
        }

        try {
            const settings = await settingsService.getInferenceSettings();
            const fastModel = settings.fastModel;
            if (!fastModel) return candidates[0].id;

            const prompt = `You are a knowledge graph curator. Choose the most "Canonical" symbol identity from this group of redundant symbols.
            
            CRITERIA:
            1. CORE symbols (those with "CORE" in their ID or Name) ALWAYS take precedence.
            2. Most descriptive and permanent-sounding ID.
            3. Most appropriate and specific domain (User > Root > State > others).
            4. Latest "updated_at" timestamp if all else is equal.
            
            CANDIDATES:
            ${candidates.map((s, i) => `${i + 1}. [${s.id}] in domain "${s.symbol_domain}" (Updated: ${s.updated_at}) Name: ${s.name}`).join('\n')}
            
            Output ONLY the ID of the winner. Valid JSON: { "winnerId": "..." }`;

            let response: any = {};
            if (settings.provider === 'gemini') {
                const client = await getGeminiClient();
                const model = client.getGenerativeModel({
                    model: fastModel,
                    generationConfig: { maxOutputTokens: 100 }
                });
                const result = await model.generateContent(prompt);
                response = extractJson(result.response.text());
            } else {
                const client = await getClient();
                const result = await client.chat.completions.create({
                    model: fastModel,
                    messages: [{ role: "user", content: prompt }],
                    max_tokens: 100
                });
                response = extractJson(result.choices[0]?.message?.content || "{}");
            }

            const winnerId = response.winnerId;
            const cleanWinner = candidates.find(c => c.id === winnerId)?.id;
            return cleanWinner || candidates[0].id;
        } catch (err) {
            loggerService.catError(LogCategory.KERNEL, "TopologyService: Failed to select canonical ID via model", { error: err });
            return candidates[0].id;
        }
    }

    private async mergeRedundantSymbols(groups: SymbolDef[][]) {
        for (const group of groups) {
            const groupKey = this.getGroupKey(group);
            const timestampKey = this.getGroupTimestampKey(group);

            if (this.mergeAttemptCache.get(groupKey) === timestampKey) {
                loggerService.catDebug(LogCategory.KERNEL, `TopologyService: Skipping redundant group ${groupKey} - no changes since last attempt`);
                continue;
            }

            // Record this attempt before starting (prevents loops if something crashes inside)
            this.mergeAttemptCache.set(groupKey, timestampKey);

            const canonicalId = await this.selectCanonicalId(group);
            const redundantIds = group.map(s => s.id).filter(id => id !== canonicalId);

            if (redundantIds.length === 0) {
                loggerService.catDebug(LogCategory.KERNEL, `TopologyService: Redundant group ${groupKey} evaluated, but leader was unchanged and no merges performed.`);
                continue;
            }

            loggerService.catInfo(LogCategory.KERNEL, `TopologyService: Merging redundant symbols into selected leader ${canonicalId}`, { redundantIds });

            for (const oldId of redundantIds) {
                try {
                    await domainService.mergeSymbols(canonicalId, oldId);
                    eventBusService.emitKernelEvent(KernelEventType.SYMBOL_COMPRESSION, {
                        canonicalId,
                        redundantId: oldId
                    });
                } catch (error) {
                    loggerService.catError(LogCategory.KERNEL, `TopologyService: Failed to merge ${oldId} into ${canonicalId}`, { error });
                }
            }
        }
    }

    private async refactorLinksToCanonical(symbols: SymbolDef[]): Promise<number> {
        loggerService.catInfo(LogCategory.KERNEL, "TopologyService: Starting link type refactoring");
        const canonicalTypes = new Set(Object.keys(RECIPROCAL_MAP));
        let refactoredCount = 0;

        for (const s of symbols) {
            if (!s.linked_patterns || s.linked_patterns.length === 0) continue;

            let updated = false;
            for (const link of s.linked_patterns) {
                if (!link.link_type) {
                    link.link_type = 'relates_to';
                    updated = true;
                    refactoredCount++;
                    continue;
                }

                if (!canonicalTypes.has(link.link_type)) {
                    // Smart refactor: Check if it's a composite string from the prompt (e.g. "orchestrates / orchestrated_by")
                    if (link.link_type.includes('/')) {
                        const parts = link.link_type.split('/').map(p => p.trim());
                        const validPart = parts.find(p => canonicalTypes.has(p));
                        if (validPart) {
                            loggerService.catDebug(LogCategory.KERNEL, `TopologyService: Refactoring composite link type "${link.link_type}" -> "${validPart}"`);
                            link.link_type = validPart;
                            updated = true;
                            refactoredCount++;
                            continue;
                        }
                    }

                    loggerService.catDebug(LogCategory.KERNEL, `TopologyService: Refactoring non-canonical link type "${link.link_type}" to "relates_to" for symbol ${s.id}`);
                    link.link_type = 'relates_to';
                    updated = true;
                    refactoredCount++;
                }
            }

            if (updated) {
                await domainService.addSymbol(s.symbol_domain, s);
            }
        }

        if (refactoredCount > 0) {
            loggerService.catInfo(LogCategory.KERNEL, `TopologyService: Refactored ${refactoredCount} links to canonical taxonomy`);
        }
        return refactoredCount;
    }

    private async instantiateMissingReflexiveLinks(symbols: SymbolDef[]): Promise<number> {
        loggerService.catInfo(LogCategory.KERNEL, "TopologyService: Starting reflexive link instantiation");

        // 1. Build a map of existing links for fast lookup
        const linkMap = new Set<string>();
        for (const s of symbols) {
            if (!s.linked_patterns) continue;
            for (const link of s.linked_patterns) {
                linkMap.add(`${s.id}:${link.id}:${link.link_type}`);
            }
        }

        let createdCount = 0;
        const updatedSymbols = new Map<string, SymbolDef>();
        const idToSymbol = new Map(symbols.map(s => [s.id, s]));

        // 2. Identify missing reciprocals
        for (const s of symbols) {
            if (!s.linked_patterns) continue;

            for (const link of s.linked_patterns) {
                const targetId = link.id;
                const forwardType = link.link_type;
                const reciprocalType = RECIPROCAL_MAP[forwardType];

                if (!reciprocalType) continue;
                if (targetId === s.id) continue; // NO SELF LINKS

                const reciprocalKey = `${targetId}:${s.id}:${reciprocalType}`;
                if (!linkMap.has(reciprocalKey)) {
                    // Missing!
                    const targetSymbol = updatedSymbols.get(targetId) || idToSymbol.get(targetId);
                    if (targetSymbol) {
                        if (!targetSymbol.linked_patterns) targetSymbol.linked_patterns = [];

                        // Check if it already exists in the local object but not in the global set yet
                        const alreadyAdded = targetSymbol.linked_patterns.some(l => l.id === s.id && l.link_type === reciprocalType);
                        if (!alreadyAdded) {
                            targetSymbol.linked_patterns.push({
                                id: s.id,
                                link_type: reciprocalType
                            });
                            updatedSymbols.set(targetId, targetSymbol);
                            createdCount++;
                            // Add to map to prevent double creation in this run
                            linkMap.add(reciprocalKey);
                        }
                    }
                }
            }
        }

        // 3. Persist changes
        if (updatedSymbols.size > 0) {
            const symbolsToUpdate = Array.from(updatedSymbols.values());
            await domainService.bulkUpsertSymbols(symbolsToUpdate);
            loggerService.catInfo(LogCategory.KERNEL, `TopologyService: Instantiated ${createdCount} missing reflexive links across ${updatedSymbols.size} symbols`);
        }

        return createdCount;
    }

    private async refactorDomainLattices(symbols: SymbolDef[]): Promise<number> {
        loggerService.catInfo(LogCategory.KERNEL, "TopologyService: Starting domain lattice refactoring");
        let linksCreated = 0;

        // 1. Group symbols by domain
        const domainMap = new Map<string, { patterns: SymbolDef[], lattices: SymbolDef[] }>();
        const idToSymbol = new Map(symbols.map(s => [s.id, s]));

        for (const s of symbols) {
            const domain = s.symbol_domain;
            if (!domainMap.has(domain)) {
                domainMap.set(domain, { patterns: [], lattices: [] });
            }
            if (s.kind === 'lattice') {
                domainMap.get(domain)!.lattices.push(s);
            } else if (s.kind === 'pattern') {
                domainMap.get(domain)!.patterns.push(s);
            }
        }

        // 2. For each domain, find patterns with no connection to a lattice IN THAT DOMAIN
        for (const [domainId, { patterns, lattices }] of domainMap.entries()) {
            if (lattices.length === 0 || patterns.length === 0) continue;

            for (const pattern of patterns) {
                const linkedLatticeIds = (pattern.linked_patterns || [])
                    .filter(l => idToSymbol.get(l.id)?.kind === 'lattice' && idToSymbol.get(l.id)?.symbol_domain === domainId)
                    .map(l => l.id);

                if (linkedLatticeIds.length === 0) {
                    // This pattern is unanchored in its domain!
                    loggerService.catDebug(LogCategory.KERNEL, `TopologyService: Pattern ${pattern.id} is unanchored in domain ${domainId}. Attempting reconciliation...`);

                    try {
                        const settings = await settingsService.getInferenceSettings();
                        const fastModel = settings.fastModel;
                        if (!fastModel) continue;

                        const prompt = `### KNOWLEDGE GRAPH ARCHITECT: DOMAIN DOCKING MISSION

                        Analyze the following symbolic pattern and determine if it should be "docked" into one or more of the provided domain lattices.

                        PATTERN TO DOCK:
                        ID: ${pattern.id}
                        Name: "${pattern.name}"
                        Role: ${pattern.role}
                        Macro: ${pattern.macro}

                        AVAILABLE LATTICES IN DOMAIN "${domainId}":
                        ${lattices.map((l, i) => `${i + 1}. ID: ${l.id} | Name: ${l.name} | Role: ${l.role}`).join('\n')}

                        #### MISSION GOAL:
                        Identify 1-3 lattices that best characterize the structural context for this pattern. 

                        #### CONSTRAINTS:
                        1. **ID ACCURACY**: Use the EXACT ID string provided in the list (e.g. "LATTICE_ID", NOT "[LATTICE_ID]").
                        2. **CONCISENESS**: Keep "reason" fields to a single sentence maximum.
                        3. **FORMAT**: Output EXCLUSIVELY valid JSON. No preamble.
                        4. **LINKS**: Use canonical link types (e.g. "part_of", "exemplifies", "relates_to").

                        #### OUTPUT SCHEMA:
                        {
                        "shouldLink": boolean,
                        "matches": [
                        {
                        "id": "LATTICE_ID_HERE",
                        "linkType": "canonical_link_type",
                        "reason": "Single sentence justification."
                        }
                        ]
                        }`;

                        let response: any = {};
                        if (settings.provider === 'gemini') {
                            const client = await getGeminiClient();
                            const model = client.getGenerativeModel({
                                model: fastModel,
                                generationConfig: {
                                    maxOutputTokens: 2048,
                                    temperature: 0.1
                                }
                            });
                            const result = await model.generateContent(prompt);
                            response = extractJson(result.response.text());
                        } else {
                            const client = await getClient();
                            const result = await client.chat.completions.create({
                                model: fastModel,
                                messages: [{ role: "user", content: prompt }],
                                max_tokens: 2048,
                                temperature: 0.1
                            });
                            response = extractJson(result.choices[0]?.message?.content || "{}");
                        }

                        if (response.shouldLink && Array.isArray(response.matches)) {
                            for (const match of response.matches) {
                                // SANITIZE ID: Remove brackets if model hallucinated them
                                const cleanMatchId = (match.id || '').replace(/^\[|\]$/g, '');

                                if (cleanMatchId === pattern.id) continue; // NO SELF LINKS
                                if (lattices.some(l => l.id === cleanMatchId)) {
                                    loggerService.catInfo(LogCategory.KERNEL, `TopologyService: Docking pattern ${pattern.id} into lattice ${cleanMatchId} via ${match.linkType}`);

                                    pattern.linked_patterns = pattern.linked_patterns || [];
                                    if (!pattern.linked_patterns.some(l => l.id === cleanMatchId)) {
                                        pattern.linked_patterns.push({
                                            id: cleanMatchId,
                                            link_type: match.linkType || 'part_of'
                                        });
                                        await domainService.addSymbol(pattern.symbol_domain, pattern);
                                        linksCreated++;
                                    }
                                }
                            }
                        }
                    } catch (err) {
                        loggerService.catError(LogCategory.KERNEL, `TopologyService: Failed domain refactor for pattern ${pattern.id}`, { error: err });
                    }
                }
            }
        }

        // 3. Collect patterns that are STILL unanchored after docking attempts
        const unanchoredByDomain = new Map<string, SymbolDef[]>();
        for (const [domainId, { patterns }] of domainMap.entries()) {
            const unanchored = patterns.filter(pattern => {
                const linkedLatticeIds = (pattern.linked_patterns || [])
                    .filter(l => idToSymbol.get(l.id)?.kind === 'lattice' && idToSymbol.get(l.id)?.symbol_domain === domainId)
                    .map(l => l.id);
                return linkedLatticeIds.length === 0;
            });
            if (unanchored.length > 0) {
                unanchoredByDomain.set(domainId, unanchored);
            }
        }

        // 4. Synthesize new lattices for unanchored clusters using the BIG model
        for (const [domainId, unanchoredPatterns] of unanchoredByDomain.entries()) {
            if (unanchoredPatterns.length < 10) continue; // Skip if too few patterns to justify new lattice synthesis

            loggerService.catInfo(LogCategory.KERNEL, `TopologyService: Synthesizing new lattices for ${unanchoredPatterns.length} unanchored patterns in domain ${domainId}`);

            try {
                const settings = await settingsService.getInferenceSettings();
                const bigModel = settings.model;
                if (!bigModel) continue;

                const prompt = `### KNOWLEDGE GRAPH ARCHITECT: LATTICE SYNTHESIS MISSION

The following symbolic patterns are currently "UNANCHORED" in the domain "${domainId}". 
They represent fragmented knowledge that lacks a high-level abstract container (Lattice).

#### UNANCHORED PATTERNS:
${unanchoredPatterns.map((p, i) => `${i + 1}. [${p.id}] "${p.name}"
   - Role: ${p.role}
   - Macro: ${p.macro}
   - Triad: ${p.triad}
   - Activation: ${JSON.stringify(p.activation_conditions)}`).join('\n')}

#### MISSION GOAL:
Synthesize 1-3 NEW Lattices that encompass logical subsets of these patterns. 
A Lattice is a high-level abstract container providing structural "docking points" for related patterns.

#### CANONICAL VALUE OPTIONS:
1. **LATTICE TOPOLOGY**: [ inductive, deductive, bidirectional, invariant, energy, constellation ]
2. **LATTICE CLOSURE**: [ loop, branch, collapse, constellation, synthesis ]
3. **FACET COMMIT**: [ atomic, volatile, shared ]
4. **FACET TEMPORAL**: [ perpetual, static, episodic, transient ]
5. **LINK TYPES**: [ relates_to, depends_on, part_of, contains, instance_of, exemplifies, informs, triggers, negates, implements, extends, synthesized_from, derived_from, feeds_into, orchestrates, monitors, validates, enables, executes, documents, contrasts_with, references, grounds_in ]

#### CONSTRAINTS:
1. **TRIADIC FLOW**: A "Triad" is a three-emoji string (Entity -> Process -> Result) representing the energy flow. Synthesize a Triad for each Lattice that governs its members (e.g., 👤⚙️💎).
2. **IDS**: Lattice IDs must be unique, descriptive, and UPPERCASE_UNDERSCORE (e.g., QUANTUM_COHERENCE_LATTICE).
3. **LINKS**: Map members to the Lattice using "relates_to" as the default link type unless a more specific canonical type is highly certain.
4. **FULL SPECIFICATION**: Provide all facets and structural properties. Do not simplify.

#### OUTPUT SCHEMA:
{
  "lattices": [
    {
      "id": "DOMAIN-PREFIX-FUNCTION-LATTICE",
      "name": "Descriptive Name",
      "role": "High-level abstract role",
      "macro": "Concise functional definition (Macro syntax: INPUT -> PROCESS -> OUTPUT)",
      "triad": "EMOJI_ENTITY_EMOJI_PROCESS_EMOJI_RESULT",
      "symbol_tag": "Descriptive tag",
      "failure_mode": "Description of what happens if this lattice fails",
      "lattice": {
        "topology": "CANONICAL_TOPOLOGY",
        "closure": "CANONICAL_CLOSURE"
      },
      "facets": {
        "function": "Functional description",
        "topology": "CANONICAL_TOPOLOGY",
        "commit": "CANONICAL_COMMIT",
        "temporal": "CANONICAL_TEMPORAL",
        "gate": ["required", "tags/invariants"],
        "substrate": ["symbolic", "cognitive", "relational", "etc"],
        "invariants": ["rule1", "rule2"]
      },
      "member_ids": ["pattern_id_1", "pattern_id_2"],
      "link_type": "relates_to"
    }
  ]
}`;

                let response: any = {};
                if (settings.provider === 'gemini') {
                    const client = await getGeminiClient();
                    const model = client.getGenerativeModel({
                        model: bigModel,
                        generationConfig: {
                            maxOutputTokens: 8192,
                            temperature: 0.2
                        }
                    });
                    const result = await model.generateContent(prompt);
                    response = extractJson(result.response.text());
                } else {
                    const client = await getClient();
                    const result = await client.chat.completions.create({
                        model: bigModel,
                        messages: [{ role: "user", content: prompt }],
                        max_tokens: 8192,
                        temperature: 0.2
                    });
                    response = extractJson(result.choices[0]?.message?.content || "{}");
                }

                if (Array.isArray(response.lattices)) {
                    for (const latDef of response.lattices) {
                        const newLattice: SymbolDef = {
                            id: latDef.id.toUpperCase().replace(/\s+/g, '_'),
                            name: latDef.name,
                            role: latDef.role,
                            macro: latDef.macro,
                            kind: 'lattice',
                            symbol_domain: domainId,
                            created_at: new Date().toISOString(),
                            updated_at: new Date().toISOString(),
                            last_accessed_at: new Date().toISOString(),
                            triad: latDef.triad || '🛠️⚙️💎',
                            activation_conditions: [],
                            symbol_tag: latDef.symbol_tag || 'synthesized',
                            failure_mode: latDef.failure_mode || 'Unknown',
                            facets: {
                                function: latDef.facets?.function || 'Lattice',
                                topology: latDef.facets?.topology || latDef.lattice?.topology || 'inductive',
                                commit: latDef.facets?.commit || 'volatile',
                                temporal: latDef.facets?.temporal || 'static',
                                gate: latDef.facets?.gate || [],
                                substrate: latDef.facets?.substrate || [],
                                invariants: latDef.facets?.invariants || []
                            },
                            lattice: {
                                topology: latDef.lattice?.topology || 'inductive',
                                closure: latDef.lattice?.closure || 'synthesis'
                            },
                            linked_patterns: (latDef.member_ids || []).map((mid: string) => ({
                                id: mid,
                                link_type: RECIPROCAL_MAP[latDef.link_type] || 'relates_to'
                            }))
                        };

                        await domainService.addSymbol(domainId, newLattice);
                        loggerService.catInfo(LogCategory.KERNEL, `TopologyService: Synthesized new lattice ${newLattice.id} with ${newLattice.linked_patterns.length} members`);

                    }
                }
            } catch (err) {
                loggerService.catError(LogCategory.KERNEL, `TopologyService: Lattice synthesis failed for domain ${domainId}`, { error: err });
            }
        }

        return linksCreated;
    }

    private async refactorCrossDomainBridges(symbols: SymbolDef[]): Promise<number> {
        loggerService.catInfo(LogCategory.KERNEL, "TopologyService: Starting cross-domain bridge lifting");
        let bridgesLifted = 0;

        // 1. Map symbols to their parent lattices for quick lookup
        const membershipMap = new Map<string, SymbolDef>(); // patternId -> Lattice Symbol
        const idToSymbol = new Map(symbols.map(s => [s.id, s]));

        for (const s of symbols) {
            if (s.kind === 'lattice' && s.linked_patterns) {
                for (const link of s.linked_patterns) {
                    membershipMap.set(link.id, s);
                }
            }
        }

        // 2. Scan patterns for cross-domain links
        for (const s of symbols) {
            if (s.kind !== 'pattern' || !s.linked_patterns) continue;

            const sourceLattice = membershipMap.get(s.id);
            if (!sourceLattice) continue;

            for (const link of s.linked_patterns) {
                const target = idToSymbol.get(link.id);
                if (!target) continue;

                // Check if it's cross-domain
                if (target.symbol_domain !== s.symbol_domain) {
                    const targetLattice = membershipMap.get(target.id);

                    const shouldLift = await this.evaluateBridgeLifting(sourceLattice, s, target, targetLattice);
                    if (shouldLift) {
                        const success = await this.liftLinkToLattice(sourceLattice, s, target, link.link_type, targetLattice);
                        if (success) bridgesLifted++;
                    }
                }
            }
        }

        if (bridgesLifted > 0) {
            loggerService.catInfo(LogCategory.KERNEL, `TopologyService: Lifted ${bridgesLifted} cross-domain bridges to lattice level`);
        }
        return bridgesLifted;
    }

    private async evaluateBridgeLifting(sourceLattice: SymbolDef, pattern: SymbolDef, target: SymbolDef, targetLattice?: SymbolDef): Promise<boolean> {
        let fullResponse = "";
        try {
            const settings = await settingsService.getInferenceSettings();
            const fastModel = settings.fastModel;
            if (!fastModel) return false;

            const prompt = `Analyze if a cross-domain semantic relationship should be "lifted" from a specific pattern to its parent lattice.
            
            SOURCE LATTICE (Domain: ${sourceLattice.symbol_domain}):
            Name: ${sourceLattice.name}
            Role: ${sourceLattice.role}
            Triad: ${sourceLattice.triad}
            
            SOURCE PATTERN:
            Name: ${pattern.name}
            Role: ${pattern.role}
            Triad: ${pattern.triad}
            
            TARGET SYMBOL (Domain: ${target.symbol_domain}):
            Name: ${target.name}
            Role: ${target.role}
            Triad: ${target.triad}
            ${targetLattice ? `
            TARGET PARENT LATTICE:
            Name: ${targetLattice.name}
            Role: ${targetLattice.role}
            Triad: ${targetLattice.triad}
            ` : ''}
            
            QUESTION: Does this relationship represent a structural dependency or high-level semantic connection that characterizes how the SOURCE LATTICE interacts with the target domain (and potentially the TARGET LATTICE), or is it purely specific to this one pattern?
            
            Output valid JSON only:
            {
              "shouldLift": boolean,
              "reason": "Brief explanation"
            }`;

            let resultJson: any = {};
            if (settings.provider === 'gemini') {
                const client = await getGeminiClient();
                const model = client.getGenerativeModel({
                    model: fastModel,
                    generationConfig: { maxOutputTokens: 400 }
                });
                const result = await model.generateContent(prompt);
                fullResponse = result.response.text();
                resultJson = extractJson(fullResponse);
            } else {
                const client = await getClient();
                const result = await client.chat.completions.create({
                    model: fastModel,
                    messages: [{ role: "user", content: prompt }],
                    max_tokens: 400
                });
                fullResponse = result.choices[0]?.message?.content || "{}";
                resultJson = extractJson(fullResponse);
            }

            return !!resultJson.shouldLift;
        } catch (error) {
            loggerService.catError(LogCategory.KERNEL, "TopologyService: Bridge lifting evaluation failed", { 
                error: error instanceof Error ? error.message : String(error),
                fullResponse 
            });
            return false;
        }
    }

    private async liftLinkToLattice(sourceLattice: SymbolDef, sourcePattern: SymbolDef, target: SymbolDef, linkType: string, targetLattice?: SymbolDef): Promise<boolean> {
        try {
            const finalTarget = targetLattice || target;
            sourceLattice.linked_patterns = sourceLattice.linked_patterns || [];

            // Check if already exists
            if (sourceLattice.linked_patterns.some(l => l.id === finalTarget.id)) {
                return false;
            }

            loggerService.catInfo(LogCategory.KERNEL, `TopologyService: Lifting bridge link from ${sourceLattice.id} -> ${finalTarget.id} (${linkType})`);

            // 1. Add link to lattice
            sourceLattice.linked_patterns.push({
                id: finalTarget.id,
                link_type: linkType
            });

            // 2. Remove link from source pattern
            if (sourcePattern.linked_patterns) {
                sourcePattern.linked_patterns = sourcePattern.linked_patterns.filter(l => l.id !== target.id);
            }

            await domainService.addSymbol(sourceLattice.symbol_domain, sourceLattice);
            await domainService.addSymbol(sourcePattern.symbol_domain, sourcePattern);

            return true;
        } catch (error) {
            loggerService.catError(LogCategory.KERNEL, `TopologyService: Failed to lift link to lattice ${sourceLattice.id}`, { error });
            return false;
        }
    }

    private getShortestPathDistance(sourceId: string, targetId: string, idToSymbol: Map<string, SymbolDef>): number {
        if (sourceId === targetId) return 0;

        const queue: [string, number][] = [[sourceId, 0]];
        const visited = new Set<string>([sourceId]);

        while (queue.length > 0) {
            const [currentId, distance] = queue.shift()!;

            if (distance >= 3) continue; // We only care if it's < 3

            const current = idToSymbol.get(currentId);
            if (!current || !current.linked_patterns) continue;

            for (const link of current.linked_patterns) {
                const neighborId = typeof link === 'string' ? link : link.id;
                if (neighborId === targetId) return distance + 1;

                if (!visited.has(neighborId)) {
                    visited.add(neighborId);
                    queue.push([neighborId, distance + 1]);
                }
            }
        }

        return Infinity;
    }

    private findConnectedComponents(symbols: SymbolDef[]): string[][] {
        const adjacency = new Map<string, Set<string>>();

        // Build undirected adjacency map
        for (const s of symbols) {
            if (!adjacency.has(s.id)) adjacency.set(s.id, new Set());

            if (s.linked_patterns) {
                for (const link of s.linked_patterns) {
                    if (!adjacency.has(link.id)) adjacency.set(link.id, new Set());
                    adjacency.get(s.id)!.add(link.id);
                    adjacency.get(link.id)!.add(s.id); // Undirected
                }
            }
        }

        const visited = new Set<string>();
        const components: string[][] = [];

        for (const s of symbols) {
            if (visited.has(s.id)) continue;

            const component: string[] = [];
            const queue = [s.id];
            visited.add(s.id);

            while (queue.length > 0) {
                const currentId = queue.shift()!;
                component.push(currentId);

                const neighbors = adjacency.get(currentId) || new Set();
                for (const nextId of neighbors) {
                    if (!visited.has(nextId)) {
                        visited.add(nextId);
                        queue.push(nextId);
                    }
                }
            }
            components.push(component);
        }

        return components;
    }

    private async bridgeIsolatedSubgraphs(symbols: SymbolDef[]): Promise<number> {
        loggerService.catInfo(LogCategory.KERNEL, "TopologyService: Starting isolated subgraph bridging");
        const components = this.findConnectedComponents(symbols);

        if (components.length <= 1) {
            loggerService.catInfo(LogCategory.KERNEL, "TopologyService: Graph is already fully connected or empty");
            return 0;
        }

        // 1. Identify the "Mainland"
        // Priority: component with USER-RECURSIVE-CORE > largest component
        let mainlandIdx = components.findIndex(c => c.includes('USER-RECURSIVE-CORE'));
        if (mainlandIdx === -1) {
            mainlandIdx = components.findIndex(c => c.some(id => (id || '').toUpperCase().includes('CORE')));
        }
        if (mainlandIdx === -1) {
            let maxLen = -1;
            for (let i = 0; i < components.length; i++) {
                if (components[i].length > maxLen) {
                    maxLen = components[i].length;
                    mainlandIdx = i;
                }
            }
        }

        const mainlandIds = new Set(components[mainlandIdx]);
        const islands = components.filter((_, i) => i !== mainlandIdx);
        let bridgedCount = 0;

        // Sort islands so that those containing "CORE" or large clusters are processed first
        islands.sort((a, b) => {
            const aHasCore = a.some(id => (id || '').toUpperCase().includes('CORE'));
            const bHasCore = b.some(id => (id || '').toUpperCase().includes('CORE'));
            if (aHasCore && !bHasCore) return -1;
            if (!aHasCore && bHasCore) return 1;
            return b.length - a.length;
        });

        loggerService.catInfo(LogCategory.KERNEL, `TopologyService: Identified ${islands.length} isolated islands to bridge to mainland (size: ${mainlandIds.size})`);

        const idToSymbol = new Map(symbols.map(s => [s.id, s]));

        // To keep hygiene runs reasonably fast, we bridge up to 20 islands per run
        const maxIslandsPerRun = 20;
        const islandsToProcess = islands.slice(0, maxIslandsPerRun);

        for (const island of islandsToProcess) {
            // Find the best candidate from the island to bridge (the "Centroid")
            // Priority: any symbol with CORE in the name
            let centroidId = island.find(id => (id || '').toUpperCase().includes('CORE')) || island[0];

            // If no CORE, find most connected
            if (centroidId && !(centroidId || '').toUpperCase().includes('CORE')) {
                let maxLinks = -1;
                for (const id of island) {
                    const sym = idToSymbol.get(id);
                    const linkCount = sym?.linked_patterns?.length || 0;
                    if (linkCount > maxLinks) {
                        maxLinks = linkCount;
                        centroidId = id;
                    }
                }
            }

            const centroid = idToSymbol.get(centroidId);
            if (!centroid) continue;

            // NEW: Emit orphan detected event if the island is a single node
            if (island.length === 1) {
                eventBusService.emitKernelEvent(KernelEventType.ORPHAN_DETECTED, {
                    symbolId: centroid.id,
                    domainId: centroid.symbol_domain
                });
            }

            // 2. Vector search for docking points in the mainland
            try {
                // Priority docking points: Lattices from the same domain that are in the mainland
                const mainlandFilter: any = {
                    id: Array.from(mainlandIds)
                };

                // Construct search query favoring dominant domain and lattices
                const searchQuery = `${centroid.name} ${centroid.role} domain:${centroid.symbol_domain} kind:lattice ${centroid.macro}`;
                let candidates = await domainService.search(searchQuery, 10, mainlandFilter);

                if (candidates.length === 0) {
                    // FALLBACK: If mainland search fails, try searching just the domain for potential (unlinked) lattices
                    // that might be in the mainland but weren't highly ranked, or just good domain anchors.
                    candidates = await domainService.search(searchQuery, 10, { symbol_domain: centroid.symbol_domain });
                    // Filter to those that are actually in mainland
                    candidates = candidates.filter(c => mainlandIds.has(c.id));
                }

                if (candidates.length === 0) {
                    loggerService.catDebug(LogCategory.KERNEL, `TopologyService: No mainland candidates found for island centroid ${centroid.id}`);
                    continue;
                }

                // 3. Try top candidates for a bridge
                for (const cand of candidates) {
                    if (cand.id === centroid.id) continue; // NO SELF LINKS
                    const dockingSym = await domainService.findById(cand.id);
                    if (dockingSym) {
                        const validation = await this.validateLink(centroid, dockingSym);
                        if (validation.shouldLink) {
                            loggerService.catInfo(LogCategory.KERNEL, `TopologyService: Bridging island centroid ${centroid.id} to mainland docking point ${dockingSym.id} via ${validation.linkType}`);

                            centroid.linked_patterns = centroid.linked_patterns || [];
                            // Ensure we don't add duplicate
                            if (!centroid.linked_patterns.some(l => l.id === dockingSym.id)) {
                                centroid.linked_patterns.push({
                                    id: dockingSym.id,
                                    link_type: validation.linkType || 'relates_to'
                                });

                                await domainService.addSymbol(centroid.symbol_domain, centroid);
                                bridgedCount++;

                                // Merge this island into mainland set immediately for next island logic
                                island.forEach(id => mainlandIds.add(id));
                                break; // Bridge found for this island
                            }
                        }
                    }
                }
            } catch (err) {
                loggerService.catError(LogCategory.KERNEL, `TopologyService: Failed to bridge island ${centroidId}`, { error: err });
            }
        }

        return bridgedCount;
    }
}

export const topologyService = new TopologyService();
