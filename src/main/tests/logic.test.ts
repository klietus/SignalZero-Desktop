import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stripThoughts, extractJson } from '../services/inferenceService.js';
import { projectService } from '../services/projectService.js';
import { domainService } from '../services/domainService.js';

// Mock Services
vi.mock('../services/domainService.js', () => ({
    domainService: {
        listDomains: vi.fn().mockResolvedValue(['root', 'user', 'state', 'test-domain']),
        getDomain: vi.fn().mockResolvedValue({ id: 'test-domain', name: 'Test Domain', invariants: [] }),
        getSymbols: vi.fn().mockResolvedValue([{ id: 'SYM-1', name: 'Symbol 1' }]),
        clearAll: vi.fn(),
        createDomain: vi.fn(),
        bulkUpsert: vi.fn()
    }
}));

vi.mock('../services/testService.js', () => ({
    testService: {
        listTestSets: vi.fn().mockResolvedValue([]),
        replaceAllTestSets: vi.fn()
    }
}));

vi.mock('../services/agentService.js', () => ({
    agentService: {
        listAgents: vi.fn().mockResolvedValue([]),
        upsertAgent: vi.fn()
    }
}));

vi.mock('../services/systemPromptService.js', () => ({
    systemPromptService: {
        loadPrompt: vi.fn().mockResolvedValue('base prompt'),
        setPrompt: vi.fn()
    }
}));

vi.mock('../services/mcpPromptService.js', () => ({
    mcpPromptService: {
        loadPrompt: vi.fn().mockResolvedValue('mcp prompt'),
        setPrompt: vi.fn()
    }
}));

describe('Inference Logic Parity', () => {
    it('should strip thoughts correctly', () => {
        const text = "Hello <think>internal reasoning</think> world <thought>more reasoning</thought>!";
        expect(stripThoughts(text)).toBe("Hello world !");
    });

    it('should preserve newlines in stripThoughts', () => {
        const text = "Line 1\n<think>reasoning</think>\nLine 2\n\nLine 3";
        const result = stripThoughts(text);
        expect(result).toBe("Line 1\n\nLine 2\n\nLine 3");
    });

    it('should extract JSON from markdown or raw strings', () => {
        const raw = '{"key": "value"}';
        const markdown = 'Here is the data:\n```json\n{"key": "value"}\n```';
        const messy = 'Some text {"key": "value"} more text';

        expect(extractJson(raw)).toEqual({ key: 'value' });
        expect(extractJson(markdown)).toEqual({ key: 'value' });
        expect(extractJson(messy)).toEqual({ key: 'value' });
    });
});

describe('Project Service Parity', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should export and import a project (Parity with LocalNode)', async () => {
        const meta = { name: 'Test Project', version: '1.0', author: 'test', created_at: '', updated_at: '' };
        const sysPrompt = "System Prompt";
        const mcpPrompt = "MCP Prompt";

        const buffer = await projectService.export(meta, sysPrompt, mcpPrompt);
        expect(buffer).toBeDefined();
        expect(buffer instanceof Uint8Array).toBe(true);

        const result = await projectService.import(Buffer.from(buffer));
        // We have 2 global domains ('root' and 'test-domain') each with 1 symbol
        expect(result.stats.totalSymbols).toBe(2);
        expect(result.systemPrompt).toBe(sysPrompt);
        expect(result.mcpPrompt).toBe(mcpPrompt);
        
        expect(domainService.clearAll).toHaveBeenCalled();
        expect(domainService.createDomain).toHaveBeenCalledWith('test-domain', expect.anything());
        // bulkUpsert is called with '' for cross-domain symbols in project import
        expect(domainService.bulkUpsert).toHaveBeenCalledWith('', expect.any(Array), true);
    });
});
