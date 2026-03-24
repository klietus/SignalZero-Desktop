import { sqliteService } from './sqliteService.js';
import { loggerService } from './loggerService.js';

const SYSTEM_PROMPT_KEY = 'sz:system:prompt';

export const systemPromptService = {
    getKey: () => SYSTEM_PROMPT_KEY,

    loadPrompt: async (fallbackPrompt: string): Promise<string> => {
        try {
            const stored = await sqliteService.request(['GET', SYSTEM_PROMPT_KEY]);
            if (typeof stored === 'string' && stored.length > 0) {
                return stored;
            }
        } catch (error) {
            loggerService.error('SystemPromptService: Failed to load prompt from SQLite', { error });
        }
        return fallbackPrompt;
    },

    setPrompt: async (prompt: string): Promise<void> => {
        try {
            await sqliteService.request(['SET', SYSTEM_PROMPT_KEY, prompt]);
        } catch (error) {
            loggerService.error('SystemPromptService: Failed to persist prompt to SQLite', { error });
            throw error;
        }
    }
};
