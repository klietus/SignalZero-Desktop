import { sqliteService } from './sqliteService.js';
import { loggerService, LogCategory } from './loggerService.js';

const MCP_PROMPT_KEY = 'sz:mcp:prompt';

export const mcpPromptService = {
    getKey: () => MCP_PROMPT_KEY,

    loadPrompt: async (fallbackPrompt: string): Promise<string> => {
        try {
            const row = sqliteService.get(`SELECT value FROM kv_store WHERE key = ?`, [MCP_PROMPT_KEY]);
            if (row && typeof row.value === 'string' && row.value.length > 0) {
                return row.value;
            }
        } catch (error) {
            loggerService.catError(LogCategory.SYSTEM, 'McpPromptService: Failed to load prompt from SQLite', { error });
        }
        return fallbackPrompt;
    },

    setPrompt: async (prompt: string): Promise<void> => {
        try {
            sqliteService.run(
                `INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)`,
                [MCP_PROMPT_KEY, prompt]
            );
        } catch (error) {
            loggerService.catError(LogCategory.SYSTEM, 'McpPromptService: Failed to persist prompt to SQLite', { error });
            throw error;
        }
    }
};
