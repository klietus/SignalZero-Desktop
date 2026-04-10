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

    constructor() {}

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

            // Relational analysis requires at least 2 symbols
            const canRunRelational = symbols.length >= 2;

            // --- STRATEGY: Link Type Refactoring ---
            if (canRunRelational && (specificStrategy === 'refactor' || specificStrategy === undefined)) {
                linksRefactored = await this.refactorLinksToCanonical(symbols);
            }

            // --- STRATEGY: Instantiate Missing Reflexive Links ---
            if (canRunRelational && (specificStrategy === 'reflexive' || specificStrategy === undefined)) {
                reflexiveLinksCreated = await this.instantiateMissingReflexiveLinks(symbols);
            }

            // --- STRATEGY: Bridge Isolated Subgraphs ---
            if (canRunRelational && (specificStrategy === 'bridge' || specificStrategy === undefined)) {
                islandsBridged = await this.bridgeIsolatedSubgraphs(symbols);
            }

            // --- STRATEGY: Dead Link Cleanup ---
            if (specificStrategy === 'deadLinkCleanup' || (specificStrategy === undefined && hygiene.deadLinkCleanup)) {
                await this.cleanupDeadLinks();
            }

            // --- STRATEGY: Semantic (Vector) Analysis ---
            if (canRunRelational && (specificStrategy === 'semantic' || (specificStrategy === undefined && (hygiene.semantic.autoCompress || hygiene.semantic.autoLink)))) {
                const semanticResults = await this.runSemanticAnalysis(symbols, hygiene, this.lastRunTimestamp);
                newLinksPredicted += semanticResults.newLinks;
                redundantSymbolsFound += semanticResults.redundantCount;
            }

            // --- STRATEGY: Triadic Analysis ---
            if (canRunRelational && (specificStrategy === 'triadic' || (specificStrategy === undefined && (hygiene.triadic.autoCompress || hygiene.triadic.autoLink)))) {
                const triadicResults = await this.runTriadicAnalysis(symbols, hygiene);
                newLinksPredicted += triadicResults.newLinks;
                redundantSymbolsFound += triadicResults.redundantCount;
            }

            // --- STRATEGY: Orphan Analysis ---
            if (specificStrategy === 'orphanAnalysis' || (specificStrategy === undefined && hygiene.orphanAnalysis)) {
                await this.analyzeOrphans(symbols);
            }

            // --- STRATEGY: Link Promotion ---
            if (canRunRelational && (specificStrategy === 'promotion' || specificStrategy === undefined)) {
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
                islandsBridged
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

    private async runSemanticAnalysis(symbols: SymbolDef[], hygiene: GraphHygieneSettings, lastRun: string | null) {
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

    private async runTriadicAnalysis(symbols: SymbolDef[], hygiene: GraphHygieneSettings) {
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

            const totalDeleted = (resultTarget.changes || 0) + (resultSource.changes || 0);
            if (totalDeleted > 0) {
                loggerService.catInfo(LogCategory.KERNEL, `TopologyService: Cleaned up ${totalDeleted} dead links globally`);
            }
        } catch (error) {
            loggerService.catError(LogCategory.KERNEL, "TopologyService: Global dead link cleanup failed", { error });
        }
    }

    private async analyzeOrphans(symbols: SymbolDef[]) {
        loggerService.catInfo(LogCategory.KERNEL, "TopologyService: Starting orphan analysis");
        const incomingLinks = new Set<string>();
        symbols.forEach(s => {
            (s.linked_patterns || []).forEach(l => incomingLinks.add(typeof l === 'string' ? l : l.id));
        });

        const orphans = symbols.filter(s => {
            const hasOutgoing = s.linked_patterns && s.linked_patterns.length > 0;
            const hasIncoming = incomingLinks.has(s.id);
            return !hasOutgoing && !hasIncoming;
        });

        if (orphans.length > 0) {
            loggerService.catInfo(LogCategory.KERNEL, `TopologyService: Found ${orphans.length} orphan symbols`);
            
            for (const orphan of orphans) {
                eventBusService.emitKernelEvent(KernelEventType.ORPHAN_DETECTED, { symbolId: orphan.id, domainId: orphan.symbol_domain });
                
                // --- Semantic Healing for Orphans ---
                const searchQuery = `${orphan.name} ${orphan.role}`;
                try {
                    const candidates = await domainService.search(searchQuery, 5);

                    const validCandidates = candidates.filter(c => c.id !== orphan.id);
                    const predictedLinks: PredictedLink[] = [];

                    for (const cand of validCandidates) {
                        const candSym = await domainService.findById(cand.id);
                        if (!candSym) continue;

                        const validation = await this.validateLink(orphan, candSym);
                        if (validation.shouldLink) {
                            predictedLinks.push({
                                sourceId: orphan.id,
                                targetId: cand.id,
                                linkType: validation.linkType || 'relates_to',
                                confidence: 0.85
                            });
                        }
                    }

                    if (predictedLinks.length > 0) {
                        loggerService.catInfo(LogCategory.KERNEL, `TopologyService: Found ${predictedLinks.length} healing links for orphan ${orphan.id}`);
                        await this.promoteToTentative(predictedLinks);
                    }
                } catch (searchErr) {
                    loggerService.catError(LogCategory.KERNEL, `TopologyService: Failed semantic healing for orphan ${orphan.id}`, { error: searchErr });
                }
            }
        }
    }

    private async promoteRelatesToLinks(symbols: SymbolDef[]) {
        loggerService.catInfo(LogCategory.KERNEL, "TopologyService: Starting link promotion analysis");
        const idToSymbol = new Map<string, SymbolDef>();
        symbols.forEach(s => idToSymbol.set(s.id, s));

        for (const s of symbols) {
            if (!s.linked_patterns) continue;

            let updated = false;
            for (const link of s.linked_patterns) {
                if (link.link_type === 'relates_to') {
                    const target = idToSymbol.get(link.id);
                    if (target) {
                        const validation = await this.validateLink(s, target);
                        if (validation.shouldLink && validation.linkType && validation.linkType !== 'relates_to') {
                            loggerService.catInfo(LogCategory.KERNEL, `TopologyService: Promoting link ${s.id} -> ${target.id} to ${validation.linkType}`);
                            link.link_type = validation.linkType;
                            updated = true;
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
                    model: fastModel
                });
                const result = await model.generateContent(prompt);
                const response = result.response.text();
                resultJson = extractJson(response);
            } else {                const client = await getClient();
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

        try {
            const settings = await settingsService.getInferenceSettings();
            const fastModel = settings.fastModel;
            if (!fastModel) return candidates[0].id;

            const prompt = `You are a knowledge graph curator. Choose the most "Canonical" symbol identity from this group of redundant symbols.
            
            CRITERIA:
            1. Most descriptive and permanent-sounding ID.
            2. Most appropriate and specific domain (User > Root > State > others).
            3. Latest "updated_at" timestamp if all else is equal.
            
            CANDIDATES:
            ${candidates.map((s, i) => `${i + 1}. [${s.id}] in domain "${s.symbol_domain}" (Updated: ${s.updated_at}) Name: ${s.name}`).join('\n')}
            
            Output ONLY the ID of the winner. Valid JSON: { "winnerId": "..." }`;

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

    private findConnectedComponents(symbols: SymbolDef[]): string[][] {
        const idToLinks = new Map<string, string[]>();
        for (const s of symbols) {
            const links = (s.linked_patterns || []).map(l => l.id);
            idToLinks.set(s.id, links);
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

                const neighbors = idToLinks.get(currentId) || [];
                for (const nextId of neighbors) {
                    if (!visited.has(nextId) && idToLinks.has(nextId)) {
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

        // Identify the "Mainland" (component containing user-recursive-core or largest)
        let mainlandIdx = components.findIndex(c => c.includes('user-recursive-core'));
        if (mainlandIdx === -1) {
            // Find largest
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

        loggerService.catInfo(LogCategory.KERNEL, `TopologyService: Identified ${islands.length} isolated islands to bridge to mainland (size: ${mainlandIds.size})`);

        const idToSymbol = new Map(symbols.map(s => [s.id, s]));

        for (const island of islands) {
            // 1. Find the "Centroid" of the island (symbol with most links)
            let centroidId = island[0];
            let maxLinks = -1;
            for (const id of island) {
                const sym = idToSymbol.get(id);
                const linkCount = sym?.linked_patterns?.length || 0;
                if (linkCount > maxLinks) {
                    maxLinks = linkCount;
                    centroidId = id;
                }
            }

            const centroid = idToSymbol.get(centroidId);
            if (!centroid) continue;

            // 2. Vector search for docking points in the mainland
            try {
                const mainlandFilter = { id: Array.from(mainlandIds) };
                const candidates = await domainService.search(`${centroid.name} ${centroid.role}`, 3, mainlandFilter);
                
                if (candidates.length === 0) continue;

                // 3. LLM Validation and docking
                const dockingSym = await domainService.findById(candidates[0].id);
                if (dockingSym) {
                    const validation = await this.validateLink(centroid, dockingSym);
                    if (validation.shouldLink) {
                        loggerService.catInfo(LogCategory.KERNEL, `TopologyService: Bridging island centroid ${centroid.id} to mainland docking point ${dockingSym.id} via ${validation.linkType}`);
                        
                        centroid.linked_patterns = centroid.linked_patterns || [];
                        centroid.linked_patterns.push({
                            id: dockingSym.id,
                            link_type: validation.linkType || 'relates_to'
                        });

                        // Saving centroid will also trigger automatic reciprocation back from the docking symbol
                        await domainService.addSymbol(centroid.symbol_domain, centroid);
                        bridgedCount++;

                        // Add this island to mainlandIds to prevent double bridging if we run multiple passes
                        island.forEach(id => mainlandIds.add(id));
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
