import { describe, it, expect, beforeEach, vi } from 'vitest';
import { systemPromptService } from '../services/systemPromptService.js';
import { sqliteService } from '../services/sqliteService.js';

describe('SystemPromptService Relational', () => {
    beforeEach(() => {
        sqliteService.__sqliteTestUtils.reset();
    });

    it('should load fallback prompt if nothing stored', async () => {
        const fallback = 'Fallback Prompt';
        const loaded = await systemPromptService.loadPrompt(fallback);
        expect(loaded).toBe(fallback);
    });

    it('should persist and reload prompt from kv_store', async () => {
        const custom = 'Custom Kernel Prompt';
        await systemPromptService.setPrompt(custom);
        const loaded = await systemPromptService.loadPrompt('something else');
        expect(loaded).toBe(custom);
    });
});
