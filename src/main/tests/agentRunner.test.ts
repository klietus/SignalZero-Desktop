import { describe, it, expect, vi, beforeEach } from 'vitest';
import { agentRunner } from '../services/agentRunner.js';
import { agentService } from '../services/agentService.js';
import { contextService } from '../services/contextService.js';
import { MonitoringDelta } from '../types.js';

vi.mock('../services/agentService.js', () => ({
    agentService: {
        listAgents: vi.fn(),
        markDeltaProcessed: vi.fn(),
        logExecution: vi.fn()
    }
}));

vi.mock('../services/contextService.js', () => ({
    contextService: {
        listSessions: vi.fn().mockResolvedValue([]),
        createSession: vi.fn().mockResolvedValue({ id: 'mock-session' })
    }
}));

vi.mock('../services/inferenceService.js', () => ({
    sendMessageAndHandleTools: vi.fn().mockImplementation(async function* () {
        yield { text: "Batch processed" };
    }),
    getChatSession: vi.fn().mockResolvedValue({}),
    getGeminiClient: vi.fn(),
    getClient: vi.fn(),
    extractJson: vi.fn()
}));

vi.mock('../services/settingsService.js', () => ({
    settingsService: {
        getInferenceSettings: vi.fn().mockResolvedValue({ fastModel: 'm', model: 'm' })
    }
}));

vi.mock('../services/systemPromptService.js', () => ({
    systemPromptService: {
        loadPrompt: vi.fn().mockResolvedValue('base prompt')
    }
}));

vi.mock('../services/toolsService.js', () => ({
    createToolExecutor: vi.fn()
}));

vi.mock('../services/loggerService.js', () => ({
    loggerService: {
        catInfo: vi.fn(),
        catWarn: vi.fn(),
        catError: vi.fn(),
        catDebug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    },
    LogCategory: {
        AGENT: 'AGENT'
    }
}));

vi.mock('../services/eventBusService.js', () => ({
    eventBusService: {
        on: vi.fn(),
        emitKernelEvent: vi.fn()
    }
}));

describe('AgentRunner Chunking', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should process deltas in chunks of 15', async () => {
        const agent = { id: 'test-agent', enabled: true, prompt: '...', subscriptions: ['test'] };
        (agentService.listAgents as any).mockResolvedValue([agent]);

        // Access private pendingBatches via any
        const deltas: MonitoringDelta[] = Array.from({ length: 35 }, (_, i) => ({
            id: `delta-${i}`,
            sourceId: 'src',
            period: 'hour',
            content: `Delta ${i}`,
            timestamp: new Date().toISOString()
        }));

        (agentRunner as any).pendingBatches.set(agent.id, deltas);

        // Spy on executeAgentBatchTurn
        const executeSpy = vi.spyOn(agentRunner as any, 'executeAgentBatchTurn').mockResolvedValue(undefined);

        await (agentRunner as any).runBatchRound();

        // 35 deltas / 15 size = 3 chunks (15, 15, 5)
        expect(executeSpy).toHaveBeenCalledTimes(3);
        expect(executeSpy).toHaveBeenNthCalledWith(1, agent, deltas.slice(0, 15));
        expect(executeSpy).toHaveBeenNthCalledWith(2, agent, deltas.slice(15, 30));
        expect(executeSpy).toHaveBeenNthCalledWith(3, agent, deltas.slice(30, 35));

        // Verify markDeltaProcessed called for all
        expect(agentService.markDeltaProcessed).toHaveBeenCalledTimes(35);
    });
});
