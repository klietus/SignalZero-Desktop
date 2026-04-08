import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { domainService } from "./domainService.js";
import { traceService } from "./traceService.js";
import { SymbolDef, VectorSearchResult } from "../types.js";
import { symbolCacheService } from "./symbolCacheService.js";
import { lancedbService } from "./lancedbService.js";
import { mcpClientService } from "./mcpClientService.js";
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import { loggerService, LogCategory } from "./loggerService.js";

import { webSearchService } from "./webSearchService.js";
import { webFetchService } from "./webFetchService.js";

const execAsync = promisify(exec);

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
        source: { type: 'string' },
        verification: { type: 'string' },
        status: { type: 'string' },
        payload: { type: 'object' }
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
          link_type: { type: 'string' },
          bidirectional: { type: 'boolean' }
        },
        required: ['id', 'link_type', 'bidirectional']
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

export const PRIMARY_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'find_symbols',
      description: 'Search for symbols using semantic or structured queries.',
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
      name: 'load_symbols',
      description: 'Load specific symbols by ID.',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' } }
        },
        required: ['ids']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'upsert_symbols',
      description: 'Create or update symbols.',
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
                    symbol_data: SYMBOL_DATA_SCHEMA
                  },
                  required: ['symbol_data']
                },
                SYMBOL_DATA_SCHEMA
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
          limit: { type: 'integer', default: 5 }
        },
        required: ['query']
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
  }
];

export const createToolExecutor = (contextSessionId?: string) => {
  const executor = async (name: string, args: any): Promise<any> => {
    loggerService.info(`[ToolExecutor] ${name}`, args);

    switch (name) {
      case 'find_symbols': {
        const results: VectorSearchResult[] = [];
        for (const q of args.queries) {
          const res = await domainService.search(q.query, q.limit || 10, { metadata_filter: { symbol_domain: q.symbol_domains } });
          results.push(...res);
        }
        if (contextSessionId && results.length > 0) {
          // Minimal mapping for cache
          const { added, updated } = await symbolCacheService.batchUpsertSymbols(contextSessionId, results.map(r => r.metadata));
          await symbolCacheService.emitCacheLoad(contextSessionId);
          return { symbols: results, cache_stats: { added, updated } };
        }
        return { symbols: results };
      }

      case 'load_symbols': {
        const found: SymbolDef[] = [];
        for (const id of args.ids) {
          const s = await domainService.findById(id);
          if (s) found.push(s);
        }
        return { symbols: found };
      }

      case 'upsert_symbols': {
        for (const entry of args.symbols) {
          const data = entry.symbol_data || entry;
          await domainService.addSymbol(data.symbol_domain, data);
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
          return { results, provider };
        } catch (e: any) {
          return { error: e.message };
        }
      }

      case 'search_deltas': {
        try {
          const results = await lancedbService.searchDeltas(args.query, args.limit || 5, {
            sourceId: args.sourceId,
            period: args.period
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

          // --- Automated Symbolic Precaching from Fetch ---
          if (contextSessionId) {
            const searchTerms = [
              ...result.extracted.actors,
              ...result.extracted.events,
              ...result.extracted.verbatim_statements.map(s => s.slice(0, 100)) // Snippets of statements
            ].filter(t => t && t.length > 3);

            if (searchTerms.length > 0) {
              loggerService.catInfo(LogCategory.TOOL, `WebFetch: Searching for ${searchTerms.length} symbolic terms from content...`);
              const foundSymbols: SymbolDef[] = [];
              
              for (const term of searchTerms.slice(0, 10)) { // Limit to top 10 terms to avoid flood
                const res = await domainService.search(term, 3);
                res.forEach((r: any) => {
                  if (!foundSymbols.find(s => s.id === r.id)) {
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
