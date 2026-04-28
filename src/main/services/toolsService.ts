import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { domainService } from "./domainService.js";
import { traceService } from "./traceService.js";
import { SymbolDef, VectorSearchResult, SymbolDefV2 } from "../types.js";
import { symbolCacheService } from "./symbolCacheService.js";
import { lancedbService } from "./lancedbService.js";
import { mcpClientService } from "./mcpClientService.js";
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import { loggerService, LogCategory } from "./loggerService.js";
import { settingsService } from "./settingsService.js";
import { monitoringService } from "./monitoringService.js";
import { hybridRetrievalService } from "./hybridRetrievalService.js";
import { predicateRegistry } from "./predicateRegistry.js";
import { predicateValueIndex } from "./predicateIndexService.js";
import { embedTexts } from "./embeddingService.js";
import { domainInferenceService } from "./domainInferenceService.js";
import { topologyService } from "./topologyService.js";

import { webSearchService } from "./webSearchService.js";
import { webFetchService } from "./webFetchService.js";
import { alertTriggerService } from "./alertTriggerService.js";

const execAsync = promisify(exec);

// --- v2 Symbol Schema ---
const SYMBOL_DATA_SCHEMA_V2 = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    kind: { type: 'string', enum: ['pattern', 'lattice', 'persona', 'data'] },
    triad: { type: 'string' },
    role: { type: 'string' },
    macro: { type: 'string' },
    
    structural: {
      type: 'object',
      properties: {
        topology: { type: 'string' },
        closure: { type: 'string' },
        embedding_dim: { type: 'integer' },
        embedding_hash: { type: 'string' },
        centrality_score: { type: 'number' },
        betweenness_bucket: { type: 'string', enum: ['low', 'medium', 'high'] }
      }
    },
    
    facets: {
      type: 'object',
      properties: {
        function: { type: 'string' },
        topology: { type: 'string' },
        closure: { type: 'string' },
        commit: { type: 'string', enum: ['foundational', 'volatile'] },
        gate: { type: 'array', items: { type: 'string' } },
        substrate: { type: 'array', items: { type: 'string' } },
        temporal: { type: 'string' },
        invariants: { type: 'array', items: { type: 'string' } }
      }
    },
    
    retrieval: {
      type: 'object',
      properties: {
        predicates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              value: { type: 'string' },
              threshold: { type: 'number' }
            }
          }
        },
        recency_weight: { type: 'number' },
        last_updated_epoch: { type: 'integer' }
      }
    },
    
    persona: {
      type: 'object',
      properties: {
        recursion_level: { type: 'string' },
        function: { type: 'string' },
        fallback_behavior: { type: 'array', items: { type: 'string' } },
        linked_personas: { type: 'array', items: { type: 'string' } },
        activation_conditions: { type: 'array', items: { type: 'string' } }
      }
    },
    data: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Origin of the data.' },
        verification: { type: 'string', description: 'Verification status or method.' },
        status: { type: 'string', description: 'Current status of the data.' },
        payload: { 
          type: 'object', 
          additionalProperties: true,
          description: 'Key-value store for the actual data being recorded. REQUIRED for kind: "data".'
        }
      }
    },
    activation_conditions: { type: 'array', items: { type: 'string' } },
    failure_mode: { type: 'string' },
    symbol_domain: { type: 'string' },
    symbol_tag: { type: 'string' },
    
    links: {
      type: 'object',
      properties: {
        in: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              link_type: { type: 'string' },
              commit: { type: 'string' },
              last_updated_epoch: { type: 'integer' }
            }
          }
        },
        out: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              link_type: { type: 'string' },
              commit: { type: 'string' },
              last_updated_epoch: { type: 'integer' }
            }
          }
        },
        link_types: { type: 'object', additionalProperties: { type: 'string' } }
      }
    },
    
    version: { type: 'integer', enum: [2] },
    created_at: { type: 'string' },
    updated_at: { type: 'string' }
  },
  required: ['id', 'kind', 'triad', 'role', 'macro', 'activation_conditions', 'symbol_domain', 'failure_mode']
};

// --- Legacy v1 schema (kept for backward compat during migration) ---
const SYMBOL_DATA_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    kind: { type: 'string', enum: ['pattern', 'lattice', 'persona', 'data'] },
    triad: { type: 'string' },
    macro: { type: 'string' },
    role: { type: 'string' },
    name: { type: 'string' },
    invocations: { type: 'array', items: { type: 'string' } },
    activation_conditions: { type: 'array', items: { type: 'string' } },
    lattice: {
      type: 'object',
      properties: {
        topology: { type: 'string' },
        closure: { type: 'string' }
      }
    },
    persona: {
      type: 'object',
      properties: {
        recursion_level: { type: 'string' },
        function: { type: 'string' },
        fallback_behavior: { type: 'array', items: { type: 'string' } },
        linked_personas: { type: 'array', items: { type: 'string' } },
        activation_conditions: { type: 'array', items: { type: 'string' } }
      }
    },
    data: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Origin of the data.' },
        verification: { type: 'string', description: 'Verification status or method.' },
        status: { type: 'string', description: 'Current status of the data.' },
        payload: { 
          type: 'object', 
          additionalProperties: true,
          description: 'Key-value store for the actual data being recorded. REQUIRED for kind: "data".'
        }
      }
    },
    facets: {
      type: 'object',
      properties: {
        function: { type: 'string' },
        topology: { type: 'string' },
        commit: { type: 'string' },
        gate: { type: 'array', items: { type: 'string' } },
        substrate: { type: 'array', items: { type: 'string' } },
        temporal: { type: 'string' },
        invariants: { type: 'array', items: { type: 'string' } }
      },
      required: ['function', 'topology', 'commit', 'gate', 'substrate', 'temporal', 'invariants']
    },
    symbol_domain: { type: 'string' },
    symbol_tag: { type: 'string' },
    failure_mode: { type: 'string' },
    linked_patterns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          link_type: { type: 'string' }
        },
        required: ['id', 'link_type']
      }
    }
  },
  required: ['id', 'kind', 'triad', 'macro', 'role', 'name', 'activation_conditions', 'facets', 'symbol_domain', 'failure_mode', 'linked_patterns']
};

const TRACE_DATA_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    entry_node: { type: 'string' },
    activated_by: { type: 'string' },
    activation_path: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          symbol_id: { type: 'string' },
          reason: { type: 'string' },
          link_type: { type: 'string' }
        },
        required: ['symbol_id', 'reason', 'link_type']
      }
    },
    source_context: {
      type: 'object',
      properties: {
        symbol_domain: { type: 'string' },
        trigger_vector: { type: 'string' }
      },
      required: ['symbol_domain', 'trigger_vector']
    },
    output_node: { type: 'string' },
    status: { type: 'string' }
  },
  required: ['entry_node', 'activated_by', 'activation_path', 'source_context', 'output_node', 'status']
};

// --- Natural language to predicate parsing ---
interface ParsedPredicate {
  field: string;
  value: string;
  operator: 'eq' | 'contains' | 'in' | 'similar';
}

async function parseQueryToPredicates(query: string): Promise<ParsedPredicate[]> {
  const predicates: ParsedPredicate[] = [];
  
  // Extract kind references
  const kindMatches = query.match(/\b(patterns?|lattices?|personas?|data\s+symbols?)\b/gi);
  if (kindMatches) {
    const kinds = kindMatches.map(m => {
      const lower = m.toLowerCase();
      if (lower.includes('pattern')) return 'pattern';
      if (lower.includes('lattice')) return 'lattice';
      if (lower.includes('persona')) return 'persona';
      return 'data';
    });
    if (kinds.length > 0) {
      predicates.push({ field: 'kind', value: kinds[0], operator: 'eq' });
    }
  }
  
  // Extract temporal references
  const temporalMatches = query.match(/\b(continuous|event.?driven|static|episodic|transient)\b/gi);
  if (temporalMatches) {
    const val = temporalMatches[0].toLowerCase();
    predicates.push({ field: 'temporal', value: val, operator: 'eq' });
  }
  
  // Extract commit references
  const commitMatches = query.match(/\b(foundational|volatile)\b/gi);
  if (commitMatches) {
    const val = commitMatches[0].toLowerCase();
    predicates.push({ field: 'commit', value: val, operator: 'eq' });
  }
  
  // Extract topology references
  const topoMatches = query.match(/\b(inductive|deductive|bidirectional|invariant|energy)\b/gi);
  if (topoMatches) {
    const val = topoMatches[0].toLowerCase();
    predicates.push({ field: 'topology', value: val, operator: 'eq' });
  }
  
  // Extract centrality bucket references
  const centralityMatches = query.match(/\b(high|medium|low)\s*(centrality|betweenness)?\b/gi);
  if (centralityMatches) {
    const val = centralityMatches[0].toLowerCase().replace(/\s*(centrality|betweenness)?/g, '').trim();
    if (['high', 'medium', 'low'].includes(val)) {
      predicates.push({ field: 'betweenness_bucket', value: val, operator: 'eq' });
    }
  }
  
  // Semantic snapping for substrate, gate, function fields
  // Embed once for reuse in snap calls
  let queryEmbedding: number[] | null = null;
  
  const knownFields = ['substrate', 'gate', 'function', 'role', 'macro'];
  for (const field of knownFields) {
    // Look for "substrate that includes X", "gate Y", "function X", etc.
    const fieldPattern = new RegExp(`${field}\\s+(?:that\\s+includes?|with|contains?)\\s+([\\w_,\\s]+?)\\b`, 'gi');
    let match;
    while ((match = fieldPattern.exec(query)) !== null) {
      const rawValue = match[1].trim();
      if (rawValue && rawValue.length > 1) {
        // Snap to known value via embedding index
        if (!queryEmbedding) {
          queryEmbedding = (await embedTexts([query]))[0] || null;
        }
        const snapped = queryEmbedding 
          ? predicateValueIndex.snap(field, rawValue, queryEmbedding) 
          : null;
        if (snapped && snapped.similarity >= 0.5) {
          predicates.push({ field, value: snapped.value, operator: field === 'substrate' ? 'contains' : 'eq' });
        } else {
          predicates.push({ field, value: rawValue, operator: 'similar' });
        }
      }
    }
  }
  
  // If no predicates extracted, use semantic similarity on the full query
  if (predicates.length === 0) {
    // Embed the query once, then snap to closest values across all fields
    queryEmbedding = queryEmbedding || (await embedTexts([query]))[0] || null;
    if (queryEmbedding) {
      const allFields = predicateRegistry.getAllFields();
      for (const fieldDef of allFields) {
        const values = predicateValueIndex.getValues(`${fieldDef.domainId}:${fieldDef.name}`);
        if (values.length === 0) continue;
        
        const snapped = predicateValueIndex.snap(fieldDef.name, query, queryEmbedding);
        if (snapped && snapped.similarity >= 0.5) {
          const op = fieldDef.operator || 'eq';
          predicates.push({ field: fieldDef.name, value: snapped.value, operator: op });
        }
      }
    }
  }
  
  return predicates;
}

export const SECONDARY_TOOLS_MAP: Record<string, ChatCompletionTool> = {
  run_shell_command: {
    type: 'function',
    function: {
      name: 'run_shell_command',
      description: 'Execute a bash command on the host system. High privilege.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          cwd: { type: 'string' }
        },
        required: ['command']
      }
    }
  },
  read_host_file: {
    type: 'function',
    function: {
      name: 'read_host_file',
      description: 'Read a file from the host filesystem.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string' }
        },
        required: ['file_path']
      }
    }
  },
  write_host_file: {
    type: 'function',
    function: {
      name: 'write_host_file',
      description: 'Write or overwrite a file on the host filesystem.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['file_path', 'content']
      }
    }
  },
  sys_info: {
    type: 'function',
    function: {
      name: 'sys_info',
      description: 'Get host system information.',
      parameters: {
        type: 'object',
        properties: {
          categories: { type: 'array', items: { type: 'string' } }
        }
      }
    }
  }
};

export const STATIC_PRIMARY_TOOLS: ChatCompletionTool[] = [
  // --- v2: Natural language → predicate query ---
  {
    type: 'function',
    function: {
      name: 'find_symbols_v2',
      description: 'Find symbols using natural language queries. The backend parses the query into structured predicates via the predicate embedding index. Supports: kind (pattern/lattice/persona/data), temporal (continuous/event_driven/static/episodic/transient), commit (foundational/volatile), topology (inductive/deductive/bidirectional/invariant/energy), centrality bucket (high/medium/low), substrate, gate, function, role, macro. Returns ranked results with hybrid sparse+dense scoring.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural language description. Examples: "find patterns with continuous temporal substrate", "symbols semantically similar to neuro-symbolic reasoning", "high-centrality lattices in root domain"'
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of results to return',
            default: 10
          },
          expand_depth: {
            type: 'integer',
            description: 'Degrees of graph expansion from top results (0 = no expansion)',
            default: 0
          }
        },
        required: ['query']
      }
    }
  },
  // --- v2: Load by ID with optional expansion ---
  {
    type: 'function',
    function: {
      name: 'load_symbols',
      description: 'Load specific symbols by ID with optional graph expansion and embedding inclusion.',
      parameters: {
        type: 'object',
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Symbol IDs to load'
          },
          expand: {
            type: 'object',
            properties: {
              depth: {
                type: 'integer',
                description: 'Degrees of graph expansion (0 = no expansion)'
              },
              include_links: {
                type: 'boolean',
                description: 'Include full link details'
              }
            }
          }
        },
        required: ['ids']
      }
    }
  },
  // --- v2: Seed context from centrality or predicates ---
  {
    type: 'function',
    function: {
      name: 'seed_context',
      description: 'Seed context from high-centrality nodes or predicate-matched symbols for context window preloading.',
      parameters: {
        type: 'object',
        properties: {
          seed_type: {
            type: 'string',
            enum: ['centrality', 'predicate'],
            description: 'How to select seed symbols'
          },
          bucket: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description: 'Betweenness centrality bucket (required if seed_type is centrality)'
          },
          domain: {
            type: 'string',
            description: 'Domain to scope the seed to'
          },
          predicates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string' },
                op: { type: 'string' },
                value: { type: 'string' }
              }
            },
            description: 'Predicates to match (required if seed_type is predicate)'
          },
          max_symbols: {
            type: 'integer',
            description: 'Maximum symbols to return',
            default: 50
          }
        },
        required: ['seed_type']
      }
    }
  },
  // --- v2: Deterministic symbol comparison ---
  {
    type: 'function',
    function: {
      name: 'compare_symbols',
      description: 'Deterministic comparison of symbols for redundancy, conflicts, or invariant violations. Used as a pre-filter before LLM calls.',
      parameters: {
        type: 'object',
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Symbol IDs to compare'
          },
          check: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['redundancy', 'link_conflict', 'invariant_violation']
            },
            description: 'Types of checks to perform'
          }
        },
        required: ['ids', 'check']
      }
    }
  },
  // --- Legacy: find_symbols (marked deprecated) ---
  {
    type: 'function',
    function: {
      name: 'find_symbols',
      description: '[DEPRECATED — use find_symbols_v2] Search for symbols using semantic or structured queries.',
      parameters: {
        type: 'object',
        properties: {
          queries: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                query: { type: 'string' },
                symbol_domains: { type: 'array', items: { type: 'string' } },
                limit: { type: 'integer' }
              }
            }
          }
        },
        required: ['queries']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'upsert_symbols',
      description: 'Create or update symbols. Accepts v2 format (preferred) or legacy v1 format.',
      parameters: {
        type: 'object',
        properties: {
          symbols: {
            type: 'array',
            items: {
              oneOf: [
                {
                  type: 'object',
                  properties: {
                    old_id: { type: 'string' },
                    symbol_data: SYMBOL_DATA_SCHEMA_V2
                  },
                  required: ['symbol_data']
                },
                SYMBOL_DATA_SCHEMA_V2
              ]
            }
          }
        },
        required: ['symbols']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'log_trace',
      description: 'Log a symbolic trace.',
      parameters: {
        type: 'object',
        properties: {
          trace: TRACE_DATA_SCHEMA
        },
        required: ['trace']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_deltas',
      description: 'Search for monitoring deltas (world changes) using semantic or structured queries.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Semantic search query.' },
          sourceId: { type: 'string', description: 'Optional data source ID filter.' },
          period: { type: 'string', enum: ['hour', 'day', 'week', 'month', 'year'], description: 'Optional time period filter.' },
          startDate: { type: 'string', description: 'Optional start date ISO string (e.g. 2026-04-01).' },
          endDate: { type: 'string', description: 'Optional end date ISO string.' },
          limit: { type: 'integer', default: 5 }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_domains',
      description: 'List all available symbolic domains (ontological containers).',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetch content from a URL and extract structured metadata (actors, quotes, summary, timeline).',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to fetch.' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'log_delta_alert',
      description: 'Log a delta alert for the unified alert system. Use when a monitoring delta or world-state change is significant and should be surfaced to the main model.',
      parameters: {
        type: 'object',
        properties: {
          sourceId: { type: 'string', description: 'The monitoring source ID (e.g. "gdelt", "acled").' },
          deltaId: { type: 'string', description: 'The delta ID from the monitoring stream.' },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Alert severity.' },
          summary: { type: 'string', description: 'Brief explanation of why this is significant.' }
        },
        required: ['sourceId', 'deltaId', 'severity', 'summary']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_alerts',
      description: 'Query active alerts from the unified alert system. Use to check for pending world-state changes.',
      parameters: {
        type: 'object',
        properties: {
          includeLow: { type: 'boolean', description: 'Include low severity alerts.' },
          source: { type: 'string', enum: ['agent', 'perception'], description: 'Filter by alert source.' }
        }
      }
    }
  }
];

// --- Tool executor with v2 patterns ---
export const createToolExecutor = (contextSessionId?: string) => {
  const executor = async (name: string, args: any): Promise<any> => {
    loggerService.info(`[ToolExecutor] ${name}`, args);

    switch (name) {
      case 'list_domains': {
        const domains = await domainService.listDomains();
        loggerService.catInfo(LogCategory.TOOL, `list_domains: Returning ${domains.length} domains.`, { domains });
        return { domains };
      }

      // --- v2: find_symbols_v2 ---
      case 'find_symbols_v2': {
        const predicates = await parseQueryToPredicates(args.query);
        loggerService.catInfo(LogCategory.TOOL, `find_symbols_v2: parsed ${predicates.length} predicates from query`, { query: args.query, predicates });
        
        const results = await hybridRetrievalService.retrieve(
          args.query,
          predicates,
          args.limit || 10,
          args.expand_depth || 0
        );
        
        if (contextSessionId && results.length > 0) {
          const validSymbols = results.map(r => r?.symbol).filter((s): s is SymbolDefV2 => s != null && typeof s === 'object' && s.id != null);
          const { added, updated } = await symbolCacheService.batchUpsertSymbols(
            contextSessionId,
            validSymbols as any
          );
          await symbolCacheService.emitCacheLoad(contextSessionId);
          return { symbols: results.map(r => r.symbol), cache_stats: { added, updated }, predicates_matched: results[0]?.predicates_matched || [] };
        }
        return { symbols: results.map(r => r.symbol) };
      }

      // --- v2: load_symbols with expand ---
      case 'load_symbols': {
        const found: SymbolDefV2[] = [];
        for (const id of args.ids) {
          const s = await domainService.findById(id);
          if (s) {
            const v2: SymbolDefV2 = {
              ...s,
              v2: true,
              schema_version: 2,
              commit: (s as any).v2_commit || 'volatile',
              recency_weight: (s as any).v2_recency_weight || 1.0,
              last_updated_epoch: (s as any).v2_last_updated || Date.now(),
              predicates: (s as any).predicates || {},
              links: (s as any).links || [],
            };
            found.push(v2);
          }
        }
        
        // Graph expansion
        if (args.expand?.depth && args.expand.depth > 0) {
          const expanded = await hybridRetrievalService.getSubgraph(args.ids[0], args.expand.depth);
          found.push(...expanded.filter(s => !found.find(f => f.id === s.id)));
        }
        
        return { symbols: found };
      }

      // --- v2: seed_context ---
      case 'seed_context': {
        if (args.seed_type === 'centrality') {
          // Query high-centrality symbols from the predicate index
          const bucket = args.bucket || 'high';
          const allSymbols = await domainService.getAllSymbols();
          const candidates = allSymbols.filter(s => {
            const structural = (s as any).structural;
            return structural?.betweenness_bucket === bucket;
          });
          
          // If no v2 structural data, use link count as proxy
          if (candidates.length === 0) {
            const linkCounts = new Map<string, number>();
            for (const s of allSymbols) {
              const links = await domainService.findById(s.id);
              if (links?.linked_patterns) {
                linkCounts.set(s.id, links.linked_patterns.length);
              }
            }
            candidates = allSymbols
              .map(s => ({ ...s, _linkCount: linkCounts.get(s.id) || 0 }))
              .filter(s => (s as any)._linkCount > 5)
              .slice(0, args.max_symbols || 50);
          }
          
          if (args.domain) {
            candidates = candidates.filter(s => s.symbol_domain === args.domain);
          }
          
          return { seeds: candidates.slice(0, args.max_symbols || 50) };
        }
        
        if (args.seed_type === 'predicate') {
          const predicates = args.predicates?.map((p: any) => ({
            field: p.field,
            value: p.value,
            operator: p.op || 'eq'
          })) || [];
          
          const results = await hybridRetrievalService.retrieve(
            '',
            predicates,
            args.max_symbols || 50,
            0
          );
          
          return { seeds: results.map(r => r.symbol) };
        }
        
        return { error: `Unknown seed_type: ${args.seed_type}` };
      }

      // --- v2: compare_symbols ---
      case 'compare_symbols': {
        const symbols: SymbolDef[] = [];
        for (const id of args.ids) {
          const s = await domainService.findById(id);
          if (s) symbols.push(s);
        }
        
        const comparisons: any[] = [];
        
        if (args.check?.includes('redundancy')) {
          for (let i = 0; i < symbols.length; i++) {
            for (let j = i + 1; j < symbols.length; j++) {
              const s1 = symbols[i];
              const s2 = symbols[j];
              
              // Check triad similarity
              const triadMatch = s1.triad === s2.triad;
              
              // Check role similarity (simple overlap)
              const roleWords1 = new Set(s1.role.toLowerCase().split(/\s+/));
              const roleWords2 = new Set(s2.role.toLowerCase().split(/\s+/));
              let overlap = 0;
              for (const w of roleWords1) {
                if (roleWords2.has(w)) overlap++;
              }
              const roleSim = roleWords1.size > 0 ? overlap / roleWords1.size : 0;
              
              // Check macro similarity
              const macroWords1 = new Set(s1.macro.toLowerCase().split(/\s+/));
              const macroWords2 = new Set(s2.macro.toLowerCase().split(/\s+/));
              let macroOverlap = 0;
              for (const w of macroWords1) {
                if (macroWords2.has(w)) macroOverlap++;
              }
              const macroSim = macroWords1.size > 0 ? macroOverlap / macroWords1.size : 0;
              
              // Check activation conditions overlap
              const ac1 = new Set(s1.activation_conditions || []);
              const ac2 = new Set(s2.activation_conditions || []);
              let acOverlap = 0;
              for (const a of ac1) {
                if (ac2.has(a)) acOverlap++;
              }
              const acSim = ac1.size > 0 ? acOverlap / ac1.size : 0;
              
              const redundancyScore = (triadMatch ? 0.4 : 0) + (roleSim * 0.3) + (macroSim * 0.2) + (acSim * 0.1);
              
              comparisons.push({
                symbol_1: s1.id,
                symbol_2: s2.id,
                redundancy_score: Math.round(redundancyScore * 100) / 100,
                triad_match: triadMatch,
                role_similarity: Math.round(roleSim * 100) / 100,
                macro_similarity: Math.round(macroSim * 100) / 100,
                activation_overlap: Math.round(acSim * 100) / 100,
                likely_redundant: redundancyScore > 0.6
              });
            }
          }
        }
        
        if (args.check?.includes('link_conflict')) {
          for (let i = 0; i < symbols.length; i++) {
            for (let j = i + 1; j < symbols.length; j++) {
              const s1 = symbols[i];
              const s2 = symbols[j];
              
              const links1 = s1.linked_patterns || [];
              const links2 = s2.linked_patterns || [];
              
              // Check for conflicting link types between same pair
              const conflicts: any[] = [];
              for (const l1 of links1) {
                const target1 = typeof l1 === 'string' ? l1 : l1.id;
                const type1 = typeof l1 === 'string' ? 'relates_to' : (l1.link_type || 'relates_to');
                for (const l2 of links2) {
                  const target2 = typeof l2 === 'string' ? l2 : l2.id;
                  const type2 = typeof l2 === 'string' ? 'relates_to' : (l2.link_type || 'relates_to');
                  if (target1 === target2 && type1 !== type2) {
                    conflicts.push({
                      target: target1,
                      type_from_s1: type1,
                      type_from_s2: type2
                    });
                  }
                }
              }
              
              if (conflicts.length > 0) {
                comparisons.push({
                  symbol_1: s1.id,
                  symbol_2: s2.id,
                  link_conflicts: conflicts
                });
              }
            }
          }
        }
        
        if (args.check?.includes('invariant_violation')) {
          // Check each symbol against its domain invariants
          for (const sym of symbols) {
            const domain = await domainService.get(sym.symbol_domain);
            if (domain?.invariants && domain.invariants.length > 0) {
              const violations: string[] = [];
              // Simple invariant checks (expand as needed)
              for (const inv of domain.invariants) {
                if (typeof inv === 'string' && inv.toLowerCase().includes('no-silent-mutation')) {
                  // Check that symbol has audit trail (v2 last_updated)
                  if (!(sym as any).v2_last_updated) {
                    violations.push(`Missing audit trail: ${inv}`);
                  }
                }
              }
              if (violations.length > 0) {
                comparisons.push({
                  symbol: sym.id,
                  domain: sym.symbol_domain,
                  invariant_violations: violations
                });
              }
            }
          }
        }
        
        return { comparisons };
      }

      // --- Legacy: find_symbols (v1) ---
      case 'find_symbols': {
        const results: VectorSearchResult[] = [];
        for (const q of args.queries) {
          const res = await domainService.search(q.query, q.limit || 10, { metadata_filter: { symbol_domain: q.symbol_domains } });
          results.push(...res);
        }
        if (contextSessionId && results.length > 0) {
          const validSymbols = results.map(r => r?.metadata).filter((s): s is SymbolDefV2 => s != null && typeof s === 'object' && s.id != null);
          const { added, updated } = await symbolCacheService.batchUpsertSymbols(contextSessionId, validSymbols as any);
          await symbolCacheService.emitCacheLoad(contextSessionId);
          return { symbols: results, cache_stats: { added, updated } };
        }
        return { symbols: results };
      }

      case 'upsert_symbols': {
        for (const entry of args.symbols) {
          const data = entry.symbol_data || entry;
          // Detect v2 format: has 'structural' or 'retrieval' fields
          const isV2 = data.structural || data.retrieval || data.version === 2;
          
          if (isV2) {
            // Convert v2 to v1-compatible format for storage
            const v1Symbol: SymbolDef = {
              id: data.id,
              name: data.name || data.id,
              kind: data.kind || 'pattern',
              triad: data.triad || '',
              role: data.role || '',
              macro: data.macro || '',
              facets: data.facets || {},
              activation_conditions: data.activation_conditions || [],
              symbol_domain: data.symbol_domain || '',
              symbol_tag: data.symbol_tag || '',
              failure_mode: data.failure_mode || '',
              linked_patterns: data.links?.out?.map((l: any) => ({ id: l.id, link_type: l.link_type })) || [],
              created_at: data.created_at || new Date().toISOString(),
              updated_at: data.updated_at || new Date().toISOString(),
              // Store v2 metadata in extended fields
              v2_commit: data.facets?.commit || 'volatile',
              v2_last_updated: data.retrieval?.last_updated_epoch ? Math.floor(data.retrieval.last_updated_epoch * 1000) : Date.now(),
            };
            await domainService.addSymbol(data.symbol_domain || '', v1Symbol);
          } else {
            await domainService.addSymbol(data.symbol_domain || '', data);
          }
        }
        return { status: "success" };
      }

      case 'log_trace': {
        await traceService.addTrace({ ...args.trace, sessionId: contextSessionId });
        return { status: "success" };
      }

      case 'run_shell_command': {
        try {
          const { stdout, stderr } = await execAsync(args.command, { cwd: args.cwd || os.homedir() });
          return { stdout, stderr };
        } catch (e: any) {
          return { error: e.message };
        }
      }

      case 'read_host_file': {
        try {
          const content = fs.readFileSync(args.file_path, 'utf-8');
          return { content };
        } catch (e: any) {
          return { error: e.message };
        }
      }

      case 'write_host_file': {
        try {
          fs.writeFileSync(args.file_path, args.content);
          return { status: "success" };
        } catch (e: any) {
          return { error: e.message };
        }
      }

      case 'sys_info': {
        return {
          platform: os.platform(),
          release: os.release(),
          arch: os.arch(),
          cpus: os.cpus().length,
          memory: { total: os.totalmem(), free: os.freemem() }
        };
      }

      case 'web_search': {
        try {
          const { results, provider } = await webSearchService.search(args.query);
          
          // --- Automated Symbolic Precaching from Search ---
          if (contextSessionId && results && results.length > 0) {
            const searchTerms = results.slice(0, 5).flatMap(r => [
              r.title,
              r.snippet?.slice(0, 100)
            ]).filter(t => t && t.length > 5);

            if (searchTerms.length > 0) {
              loggerService.catInfo(LogCategory.TOOL, `WebSearch: Searching for symbolic matches from ${results.length} search results...`);
              const foundSymbols: SymbolDef[] = [];
              
              for (const term of searchTerms.slice(0, 8)) {
                const res = await domainService.search(term, 2);
                res.forEach((r: any) => {
                  if (r?.metadata && !foundSymbols.find(s => s.id === r.metadata.id)) {
                    foundSymbols.push(r.metadata as SymbolDef);
                  }
                });
              }

              if (foundSymbols.length > 0) {
                const { added } = await symbolCacheService.batchUpsertSymbols(contextSessionId, foundSymbols);
                loggerService.catInfo(LogCategory.TOOL, `WebSearch: Injected ${added} new symbols into cache from search results.`);
                await symbolCacheService.emitCacheLoad(contextSessionId);
              }
            }
          }

          return { results, provider };
        } catch (e: any) {
          return { error: e.message };
        }
      }

      case 'search_deltas': {
        try {
          if (args.sourceId && args.period && args.startDate && args.endDate) {
            await monitoringService.ensureRollup(args.sourceId, args.period, args.startDate, args.endDate);
          }

          const results = await lancedbService.searchDeltas(args.query, args.limit || 5, {
            sourceId: args.sourceId,
            period: args.period,
            startDate: args.startDate,
            endDate: args.endDate
          });
          loggerService.catInfo(LogCategory.TOOL, `search_deltas: Found ${results.length} deltas.`, { 
            query: args.query,
            sources: results.map(r => r.metadata.sourceId)
          });
          return { deltas: results };
        } catch (e: any) {
          return { error: e.message };
        }
      }

      case 'web_fetch': {
        try {
          const result = await webFetchService.fetch(args.url);
          if (!result) return { error: "Failed to fetch or parse content." };

          if (contextSessionId) {
            const searchTerms = [
              ...result.extracted.actors,
              ...result.extracted.events,
              ...result.extracted.verbatim_statements.map(s => s.slice(0, 100))
            ].filter(t => t && t.length > 3);

            if (searchTerms.length > 0) {
              loggerService.catInfo(LogCategory.TOOL, `WebFetch: Searching for ${searchTerms.length} symbolic terms from content...`);
              const foundSymbols: SymbolDef[] = [];
              
              for (const term of searchTerms.slice(0, 10)) {
                const res = await domainService.search(term, 3);
                res.forEach((r: any) => {
                  if (r?.metadata && !foundSymbols.find(s => s.id === r.metadata.id)) {
                    foundSymbols.push(r.metadata as SymbolDef);
                  }
                });
              }

              if (foundSymbols.length > 0) {
                const { added } = await symbolCacheService.batchUpsertSymbols(contextSessionId, foundSymbols);
                loggerService.catInfo(LogCategory.TOOL, `WebFetch: Injected ${added} new symbols into cache from content analysis.`);
                await symbolCacheService.emitCacheLoad(contextSessionId);
              }
            }
          }

          return result;
        } catch (e: any) {
          return { error: e.message };
        }
      }

      case 'log_delta_alert': {
        await alertTriggerService.log({
          source: 'agent',
          severity: args.severity as 'low' | 'medium' | 'high' | 'critical',
          summary: args.summary,
          metadata: { sourceId: args.sourceId, deltaId: args.deltaId }
        });
        return { status: 'logged', alertSeverity: args.severity };
      }

      case 'query_alerts': {
        const alerts = alertTriggerService.getActive();
        const filtered = args.includeLow ? alerts : alerts.filter(a => a.severity !== 'low');
        const bySource = args.source ? filtered.filter(a => a.source === args.source) : filtered;
        return { alerts: bySource };
      }

      default:
        if (name.startsWith('mcp_')) {
          const parts = name.split('_');
          const mcpId = parts[1];
          const originalName = parts.slice(2).join('_');
          return await mcpClientService.executeTool(mcpId, originalName, args);
        }
        return { error: `Tool ${name} not found` };
    }
  };

  return executor;
};

export const getPrimaryTools = async (): Promise<ChatCompletionTool[]> => {
  const settings = await settingsService.getMonitoringSettings();
  const enabledSources = (settings.sources || []).filter(s => s.enabled);
  const sourceNames = enabledSources.map(s => `${s.name} (${s.id})`).join(', ');

  return STATIC_PRIMARY_TOOLS.map(tool => {
    if (tool.function.name === 'search_deltas') {
      const updatedTool = JSON.parse(JSON.stringify(tool));
      updatedTool.function.description = `Search for monitoring deltas (world changes). ACTIVE FEEDS: ${sourceNames || 'None active'}.`;
      
      if (enabledSources.length > 0) {
        updatedTool.function.parameters.properties.sourceId.enum = enabledSources.map(s => s.id);
      }
      
      return updatedTool;
    }
    return tool;
  });
};
