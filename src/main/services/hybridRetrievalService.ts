import { domainService } from './domainService.js';
import { predicateValueIndex } from './predicateIndexService.js';
import { sqliteService } from './sqliteService.js';
import { loggerService, LogCategory } from './loggerService.js';
import { embedTexts } from './embeddingService.js';
import { SymbolDefV2 } from '../types.js';
import { lancedbService } from './lancedbService.js';

export interface Predicate {
  field: string;
  value: string;
  operator?: 'eq' | 'contains' | 'in' | 'similar';
}

export interface HybridRetrievalResult {
  symbol: SymbolDefV2;
  score: number;
  stage: 'predicate' | 'embedding' | 'expansion';
  predicates_matched: string[];
  embedding_similarity: number;
}

export class HybridRetrievalService {
  private readonly EMBEDDING_WEIGHT = 0.5;
  private readonly RECENCY_WEIGHT = 0.2;
  private readonly LINK_WEIGHT = 0.15;
  private readonly PREDICATE_WEIGHT = 0.15;
  private readonly MIN_PREDICATE_SIMILARITY = 0.6;
  private readonly MIN_EMBEDDING_SIMILARITY = 0.3;
  private readonly LINK_CENTRALITY_MAX = 10;

  /**
   * Stage 1: Predicate pre-filter (sparse, cheap)
   */
  private async predicatePreFilter(predicates: Predicate[]): Promise<SymbolDefV2[]> {
    if (predicates.length === 0) return [];

    const candidates = new Map<string, { symbol: SymbolDefV2; predicates_matched: string[] }>();

    for (const predicate of predicates) {
      const field = predicate.field;
      const operator = predicate.operator || 'eq';

      // Check if field has indexed values
      const validValues = predicateValueIndex.getValues(`*:${field}`);
      if (validValues.length === 0) continue;

      // Get symbols matching this predicate
      let matchingSymbols: any[] = [];

      if (operator === 'eq' || operator === 'similar') {
        const snapped = predicateValueIndex.snap(field, []);
        if (!snapped || snapped.similarity < this.MIN_PREDICATE_SIMILARITY) continue;

        matchingSymbols = sqliteService.all(`
          SELECT * FROM symbols s
          JOIN domains d ON s.domain_id = d.id
          WHERE d.enabled = 1
          AND (
            (s.facets LIKE ? AND ? = 'function') OR
            (s.facets LIKE ? AND ? = 'topology') OR
            (s.facets LIKE ? AND ? = 'temporal')
          )
        `, [
          `%${snapped.value}%`, field,
          `%${snapped.value}%`, field,
          `%${snapped.value}%`, field,
        ]);
      } else if (operator === 'contains') {
        matchingSymbols = sqliteService.all(`
          SELECT * FROM symbols s
          JOIN domains d ON s.domain_id = d.id
          WHERE d.enabled = 1
          AND s.symbol_tag LIKE ?
        `, [`%${predicate.value}%`]);
      } else if (operator === 'in') {
        matchingSymbols = sqliteService.all(`
          SELECT * FROM symbols s
          JOIN domains d ON s.domain_id = d.id
          WHERE d.enabled = 1
          AND s.symbol_tag LIKE ?
        `, [`%${predicate.value}%`]);
      }

      for (const row of matchingSymbols) {
        const symbol = this.rowToV2(row);
        const existing = candidates.get(symbol.id);
        if (existing) {
          existing.predicates_matched.push(`${field}=${predicate.value}`);
        } else {
          candidates.set(symbol.id, { symbol, predicates_matched: [`${field}=${predicate.value}`] });
        }
      }
    }

    return Array.from(candidates.values()).map(c => c.symbol);
  }

  /**
   * Stage 2: Embedding rank (dense, expensive)
   */
  private async embeddingRank(query: string, candidates: SymbolDefV2[], limit: number): Promise<HybridRetrievalResult[]> {
    if (candidates.length === 0) return [];

    // Query embedding (isolated — uses embeddingService directly)
    // onnxruntime-node can crash with V8 HandleScope errors — wrap in timeout
    let queryEmbedding: number[][];
    try {
      const embedPromise = embedTexts([query]);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Embedding timed out after 5s')), 5000);
      });
      queryEmbedding = await Promise.race([embedPromise, timeoutPromise]);
    } catch (embedErr: any) {
      loggerService.catWarn(LogCategory.KERNEL, `EmbeddingRank: embedding failed, returning empty`, {
        error: embedErr.message || String(embedErr)
      });
      return [];
    }

    // Batch compute embeddings for all candidates that need them
    const textsToEmbed: { index: number; text: string }[] = [];
    const symbolEmbeddings = new Array<number[] | null>(candidates.length);

    for (let i = 0; i < candidates.length; i++) {
      const symbol = candidates[i];
      const text = `${symbol.name} ${symbol.role} ${symbol.macro} ${symbol.triad}`;
      textsToEmbed.push({ index: i, text });
      symbolEmbeddings[i] = null;
    }

    // Batch embed all texts at once
    if (textsToEmbed.length > 0) {
      try {
        const embedPromise = embedTexts(textsToEmbed.map(t => t.text));
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Batch embedding timed out after 10s')), 10000);
        });
        const batchEmbeddings = await Promise.race([embedPromise, timeoutPromise]);
        for (let j = 0; j < textsToEmbed.length; j++) {
          symbolEmbeddings[textsToEmbed[j].index] = batchEmbeddings[j];
        }
      } catch (embedErr: any) {
        loggerService.catWarn(LogCategory.KERNEL, `EmbeddingRank: batch embedding failed`, {
          error: embedErr.message || String(embedErr),
          count: textsToEmbed.length
        });
      }
    }

    // Compute similarities
    const results: HybridRetrievalResult[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const embedding = symbolEmbeddings[i];
      if (!embedding || embedding.length === 0) continue;

      const similarity = this.cosineSimilarity(queryEmbedding[0], embedding);

      if (similarity >= this.MIN_EMBEDDING_SIMILARITY) {
        results.push({
          symbol: candidates[i],
          score: similarity,
          stage: 'embedding',
          predicates_matched: [],
          embedding_similarity: similarity,
        });
      }
    }

    // Sort by similarity descending
    results.sort((a, b) => b.embedding_similarity - a.embedding_similarity);
    return results.slice(0, limit);
  }

  /**
   * Convert LanceDB search results to HybridRetrievalResult.
   * LanceDB provides fast ANN ranking; we then fetch full symbol data from SQLite.
   */
  private async lanceResultsToHybrid(lanceResults: any[]): Promise<HybridRetrievalResult[]> {
    if (lanceResults.length === 0) return [];

    const results: HybridRetrievalResult[] = [];

    for (const r of lanceResults) {
      const similarity = 1 - (r._distance || 0);
      if (similarity < this.MIN_EMBEDDING_SIMILARITY) continue;

      // Fetch full symbol from SQLite (LanceDB only has vector + basic metadata)
      const symbol = await domainService.findById(r.id);
      if (!symbol) continue;

      const v2 = this.symbolToV2(symbol);
      results.push({
        symbol: v2,
        score: similarity,
        stage: 'embedding',
        predicates_matched: [],
        embedding_similarity: similarity,
      });
    }

    return results;
  }

  /**
   * Convert a single LanceDB search result to SymbolDefV2.
   * Fetches full symbol data from SQLite.
   */
  private async symbolFromLanceResult(result: any): Promise<SymbolDefV2> {
    const symbol = await domainService.findById(result.id);
    if (!symbol) {
      // Fallback to metadata if symbol not found
      return {
        id: result.id,
        name: result.metadata?.name || result.name || '',
        kind: result.metadata?.kind || 'pattern',
        triad: result.metadata?.triad || '',
        role: result.metadata?.role || '',
        macro: result.metadata?.macro || '',
        symbol_domain: result.metadata?.domain || result.metadata?.symbol_domain || '',
        symbol_tag: result.metadata?.symbol_tag || '',
        facets: {},
        failure_mode: '',
        linked_patterns: [],
        v2: true,
        schema_version: 2,
      } as unknown as SymbolDefV2;
    }
    return this.symbolToV2(symbol);
  }

  /**
   * Stage 3: Graph-aware expansion
   */
  private async graphExpansion(results: HybridRetrievalResult[]): Promise<HybridRetrievalResult[]> {
    if (results.length === 0) return results;

    const expanded = new Map<string, HybridRetrievalResult>();

    // Seed with initial results
    for (const result of results) {
      expanded.set(result.symbol.id, result);
    }

    // Expand by one hop
    for (const result of results) {
      const links = sqliteService.all(`
        SELECT target_id as id, link_type FROM symbol_links WHERE source_id = ?
      `, [result.symbol.id]) as any[];

      for (const link of links) {
        if (expanded.has(link.id)) continue;

        const symbol = await domainService.findById(link.id);
        if (!symbol) continue;

        const v2 = this.symbolToV2(symbol);
        expanded.set(link.id, {
          symbol: v2,
          score: result.score * 0.7, // Decay score for expansion
          stage: 'expansion',
          predicates_matched: [],
          embedding_similarity: 0,
        });
      }
    }

    return Array.from(expanded.values());
  }

  /**
   * Main hybrid retrieval method.
   * Stage 1: Predicate pre-filter -> Stage 2: Embedding rank -> Stage 3: Graph expansion
   */
  async retrieve(
    query: string,
    predicates: Predicate[] = [],
    limit: number = 10,
    expandDepth: number = 0,
    domain?: string
  ): Promise<HybridRetrievalResult[]> {
    let candidates: SymbolDefV2[] = [];

    // Stage 1: Predicate pre-filter
    if (predicates.length > 0) {
      candidates = await this.predicatePreFilter(predicates);
    }

    // Stage 2: Embedding rank
    let ranked = await this.embeddingRank(query, candidates.length > 0 ? candidates : [], limit);

    // If no candidates from predicates and no results, use LanceDB vector search
    // This avoids computing embeddings for all symbols in a domain
    if (candidates.length === 0 && ranked.length === 0) {
      if (domain) {
        // Use LanceDB's ANN search with domain filter — much faster than getAllSymbols + embed all
        const lanceResults = await lancedbService.searchWithDomain(query, domain, limit * 3);
        ranked = await this.lanceResultsToHybrid(lanceResults);
        // If LanceDB returned nothing (embedding failed or no results), fall back to SQLite
        if (ranked.length === 0) {
          loggerService.catDebug(LogCategory.KERNEL, `LanceDB domain search returned 0 results, falling back to SQLite`, { domain, query });
          const allSymbols = await domainService.getAllSymbols();
          const domainSymbols = allSymbols.filter(s => s.symbol_domain === domain);
          ranked = await this.embeddingRank(query, domainSymbols.map(s => this.symbolToV2(s)), limit);
        }
      } else {
        // No domain specified — use LanceDB vector search (pre-computed embeddings, no on-the-fly embedding)
        const lanceResults = await lancedbService.search(query, limit * 3);
        if (lanceResults.length > 0) {
          ranked = await Promise.all(lanceResults.map(async (r) => ({
            symbol: await this.symbolFromLanceResult(r),
            score: r.score,
            stage: 'embedding',
            predicates_matched: [],
            embedding_similarity: r.score,
          })));
        }
      }
    }

    // Apply domain filter if specified
    if (domain) {
      ranked = ranked.filter(r => r.symbol.symbol_domain === domain);
    }

    // Stage 3: Graph expansion
    if (expandDepth > 0) {
      ranked = await this.graphExpansion(ranked);
    }

    // Compute final scores
    for (const result of ranked) {
      result.score = this.computeFinalScore(result);
    }

    // Sort by final score
    ranked.sort((a, b) => b.score - a.score);
    return ranked.slice(0, limit);
  }

  /**
   * Compute final hybrid score.
   */
  private computeFinalScore(result: HybridRetrievalResult): number {
    let score = 0;

    // Embedding similarity (50%)
    score += result.embedding_similarity * this.EMBEDDING_WEIGHT;

    // Recency weight (20%)
    const recency = result.symbol.recency_weight || 1.0;
    score += recency * this.RECENCY_WEIGHT;

    // Link centrality (15%)
    const linkCount = (result.symbol as any).links?.length || 0;
    const linkScore = Math.min(1, linkCount / this.LINK_CENTRALITY_MAX);
    score += linkScore * this.LINK_WEIGHT;

    // Predicates matched (15%)
    const predicateScore = Math.min(1, result.predicates_matched.length / 2);
    score += predicateScore * this.PREDICATE_WEIGHT;

    return score;
  }

  /**
   * Get subgraph centered on a symbol.
   */
  async getSubgraph(centerId: string, maxDepth: number = 2): Promise<SymbolDefV2[]> {
    const visited = new Set<string>();
    const symbols: SymbolDefV2[] = [];

    const queue: Array<{ id: string; depth: number }> = [{ id: centerId, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id) || depth > maxDepth) continue;

      visited.add(id);

      const symbol = await domainService.findById(id);
      if (!symbol) continue;

      symbols.push(this.symbolToV2(symbol));

      if (depth < maxDepth) {
        const links = sqliteService.all(`
          SELECT target_id as id FROM symbol_links WHERE source_id = ?
        `, [id]) as any[];

        for (const link of links) {
          if (!visited.has(link.id)) {
            queue.push({ id: link.id, depth: depth + 1 });
          }
        }
      }
    }

    return symbols;
  }

  /**
   * Cosine similarity between two vectors.
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Convert SymbolDef to SymbolDefV2.
   */
  private symbolToV2(symbol: any): SymbolDefV2 {
    return {
      ...symbol,
      commit: (symbol.v2_commit as 'foundational' | 'volatile') || 'volatile',
      recency_weight: symbol.v2_recency_weight || 1.0,
      last_updated_epoch: symbol.v2_last_updated || Date.now(),
      predicates: symbol.predicates || {},
      links: (symbol.links || []),
      v2: true,
      schema_version: 2,
    };
  }

  /**
   * Convert SQLite row to SymbolDefV2.
   */
  private rowToV2(row: any): SymbolDefV2 {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      triad: row.triad,
      role: row.role,
      macro: row.macro,
      lattice: row.lattice ? JSON.parse(row.lattice) : undefined,
      persona: row.persona ? JSON.parse(row.persona) : undefined,
      data: row.data ? JSON.parse(row.data) : undefined,
      facets: row.facets ? JSON.parse(row.facets) : {},
      activation_conditions: row.activation_conditions ? JSON.parse(row.activation_conditions) : [],
      symbol_domain: row.domain_id || row.symbol_domain || row.domain,
      symbol_tag: row.symbol_tag || '',
      failure_mode: row.failure_mode,
      linked_patterns: row.linked_patterns ? JSON.parse(row.linked_patterns) : [],
      created_at: row.created_at,
      updated_at: row.updated_at,
      commit: (row.v2_commit as 'foundational' | 'volatile') || 'volatile',
      recency_weight: row.v2_recency_weight || 1.0,
      last_updated_epoch: row.v2_last_updated || Date.now(),
      predicates: {},
      links: [],
      v2: true,
      schema_version: 2,
    };
  }
}

export const hybridRetrievalService = new HybridRetrievalService();
