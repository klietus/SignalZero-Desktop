import { sqliteService } from './sqliteService.js';
import { loggerService, LogCategory } from './loggerService.js';
import { domainService } from './domainService.js';
import { embedTexts } from './embeddingService.js';

interface IndexedValue {
  field: string;
  value: string;
  embedding: number[];
  domain_id: string;
}

interface PredicateIndexEntry {
  field: string;
  value: string;
  similarity: number;
}

export class PredicateValueIndex {
  private index: Map<string, Map<string, IndexedValue>> = new Map();
  private isBuilding = false;
  private buildingDomain: string | null = null;
  private readonly SIMILARITY_THRESHOLD = 0.3;

  /**
   * Get or create the in-memory index for a field.
   */
  private getFieldIndex(field: string): Map<string, IndexedValue> {
    if (!this.index.has(field)) {
      this.index.set(field, new Map());
    }
    return this.index.get(field)!;
  }

  /**
   * Add a value to the index with its embedding.
   */
  addValue(field: string, value: string, embedding: number[], domainId: string): void {
    const fieldIndex = this.getFieldIndex(field);
    fieldIndex.set(value, { field, value, embedding, domain_id: domainId });
  }

  /**
   * Remove a value from the index.
   */
  removeValue(field: string, value: string): void {
    const fieldIndex = this.getFieldIndex(field);
    fieldIndex.delete(value);
  }

  /**
   * Snap a natural language value to the closest indexed value for a field.
   */
  snap(field: string, text: string, queryEmbedding: number[], threshold?: number): PredicateIndexEntry | null {
    const fieldIndex = this.getFieldIndex(field);
    if (fieldIndex.size === 0) return null;
    if (!queryEmbedding || queryEmbedding.length === 0) return null;

    const simThreshold = threshold ?? this.SIMILARITY_THRESHOLD;
    let bestMatch: PredicateIndexEntry | null = null;
    let bestScore = simThreshold;

    for (const [, entry] of fieldIndex) {
      const similarity = this.cosineSimilarity(queryEmbedding, entry.embedding);
      if (similarity > bestScore) {
        bestScore = similarity;
        bestMatch = { field, value: entry.value, similarity };
      }
    }

    return bestMatch;
  }

  /**
   * Build the index from a domain's symbols.
   */
  async buildFromDomain(domainId: string): Promise<void> {
    if (this.isBuilding) {
      if (this.buildingDomain === domainId) return;
      loggerService.catWarn(LogCategory.KERNEL, `PredicateValueIndex: Index already building for domain "${this.buildingDomain}"`);
      return;
    }
    this.isBuilding = true;
    this.buildingDomain = domainId;

    try {
      loggerService.catInfo(LogCategory.KERNEL, `PredicateValueIndex: Building index for domain ${domainId}`);

      // Clear existing entries for this domain
      for (const field of Array.from(this.index.keys())) {
        if (field.startsWith(`${domainId}:`)) {
          this.index.delete(field);
        }
      }

      const allSymbols = await domainService.getSymbols(domainId);
      const fields = new Set<string>();

      for (const symbol of allSymbols) {
        if (symbol.facets) {
          const facetFields = ['function', 'topology', 'temporal'];
          for (const f of facetFields) {
            if (symbol.facets[f]) {
              fields.add(`${domainId}:${f}`);
            }
          }
        }
        if (symbol.symbol_tag) {
          fields.add(`${domainId}:tags`);
        }
        if (symbol.kind) {
          fields.add(`${domainId}:kind`);
        }
      }

      // Deduplicate values before embedding
      const valuesToEmbed: { field: string; value: string }[] = [];
      const seen = new Set<string>();

      for (const field of fields) {
        const [domId, fieldName] = field.split(':');
        for (const symbol of allSymbols) {
          let values: string[] = [];

          if (fieldName === 'function' && symbol.facets?.function) {
            values = [symbol.facets.function];
          } else if (fieldName === 'topology' && symbol.facets?.topology) {
            values = [symbol.facets.topology];
          } else if (fieldName === 'temporal' && symbol.facets?.temporal) {
            values = [symbol.facets.temporal];
          } else if (fieldName === 'tags' && symbol.symbol_tag) {
            values = symbol.symbol_tag.split(',').map(t => t.trim()).filter(Boolean);
          } else if (fieldName === 'kind' && symbol.kind) {
            values = [symbol.kind];
          }

          for (const value of values) {
            const key = `${field}:${value}`;
            if (!seen.has(key)) {
              seen.add(key);
              valuesToEmbed.push({ field, value });
            }
          }
        }
      }

      // Batch embed (isolated from symbol store — uses embeddingService directly)
      if (valuesToEmbed.length > 0) {
        const embeddings = await embedTexts(valuesToEmbed.map(v => v.value));

        for (let i = 0; i < valuesToEmbed.length; i++) {
          const { field, value } = valuesToEmbed[i];
          const [domId] = field.split(':');
          const emb = embeddings[i];
          if (emb && emb.length > 0) {
            this.addValue(field, value, emb, domId);
          } else {
            loggerService.catWarn(LogCategory.KERNEL, `PredicateValueIndex: Empty embedding for "${value}" — skipping`);
          }
        }
      }

      loggerService.catInfo(LogCategory.KERNEL, `PredicateValueIndex: Built index with ${this.index.size} fields`);
    } catch (error) {
      loggerService.catError(LogCategory.KERNEL, `PredicateValueIndex: Failed to build index for ${domainId}`, { error });
    } finally {
      this.isBuilding = false;
      this.buildingDomain = null;
    }
  }

  /**
   * Incrementally update the index with new symbols.
   */
  async incrementalUpdate(domainId: string): Promise<void> {
    const symbols = await domainService.getSymbols(domainId);

    for (const symbol of symbols) {
      if (symbol.facets?.function) {
        const embedding = await embedTexts([symbol.facets.function]);
        if (embedding[0] && embedding[0].length > 0) {
          this.addValue(`${domainId}:function`, symbol.facets.function, embedding[0], domainId);
        }
      }
      if (symbol.facets?.topology) {
        const embedding = await embedTexts([symbol.facets.topology]);
        if (embedding[0] && embedding[0].length > 0) {
          this.addValue(`${domainId}:topology`, symbol.facets.topology, embedding[0], domainId);
        }
      }
      if (symbol.facets?.temporal) {
        const embedding = await embedTexts([symbol.facets.temporal]);
        if (embedding[0] && embedding[0].length > 0) {
          this.addValue(`${domainId}:temporal`, symbol.facets.temporal, embedding[0], domainId);
        }
      }
      if (symbol.symbol_tag) {
        const tags = symbol.symbol_tag.split(',').map(t => t.trim()).filter(Boolean);
        for (const tag of tags) {
          const embedding = await embedTexts([tag]);
          if (embedding[0] && embedding[0].length > 0) {
            this.addValue(`${domainId}:tags`, tag, embedding[0], domainId);
          }
        }
      }
      if (symbol.kind) {
        const embedding = await embedTexts([symbol.kind]);
        if (embedding[0] && embedding[0].length > 0) {
          this.addValue(`${domainId}:kind`, symbol.kind, embedding[0], domainId);
        }
      }
    }
  }

  /**
   * Get all indexed fields for a domain.
   */
  getFields(domainId: string): string[] {
    const fields: string[] = [];
    for (const field of this.index.keys()) {
      if (field.startsWith(`${domainId}:`)) {
        fields.push(field);
      }
    }
    return fields;
  }

  /**
   * Get all values for a field.
   */
  getValues(field: string): string[] {
    const fieldIndex = this.getFieldIndex(field);
    return Array.from(fieldIndex.keys());
  }

  /**
   * Clear the entire index.
   */
  clear(): void {
    this.index.clear();
  }

  /**
   * Compute cosine similarity between two vectors.
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
}

export const predicateValueIndex = new PredicateValueIndex();
