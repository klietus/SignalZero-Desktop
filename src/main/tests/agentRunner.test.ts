import { describe, it, expect, vi, beforeEach } from 'vitest';
import { agentRunner } from '../services/agentRunner.js';
import { agentService } from '../services/agentService.js';
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
        getInferenceSettings: vi.fn().mockResolvedValue({ model: 'm' })
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
        const agents = [
            { id: 'agent-0', enabled: true, prompt: '...', subscriptions: ['test'] },
            { id: 'agent-1', enabled: true, prompt: '...', subscriptions: ['test'] },
            { id: 'agent-2', enabled: true, prompt: '...', subscriptions: ['test'] }
        ];
        (agentService.listAgents as any).mockResolvedValue(agents);

        // Access private pendingBatches via any
        const deltas: MonitoringDelta[] = Array.from({ length: 35 }, (_, i) => ({
            id: `delta-${i}`,
            sourceId: 'src',
            period: 'hour',
            content: `Delta ${i}`,
            timestamp: new Date().toISOString()
        }));

        const chunkSize = 15;
        const chunks: MonitoringDelta[][] = [];
        for (let i = 0; i < deltas.length; i += chunkSize) {
            chunks.push(deltas.slice(i, i + chunkSize));
        }

        // Simulate 3 agents each with a chunk (mimics what WTA routing would produce)
        ['agent-0', 'agent-1', 'agent-2'].forEach((aid, ci) => {
            (agentRunner as any).pendingBatches.set(aid, chunks[ci]);
        });

        // Spy on executeAgentBatchTurn
        const executeSpy = vi.spyOn(agentRunner as any, 'executeAgentBatchTurn').mockResolvedValue(undefined);

        await (agentRunner as any).runBatchRound();

        // 3 agents = 3 calls (one per chunk)
        expect(executeSpy).toHaveBeenCalledTimes(3);
        expect(executeSpy).toHaveBeenNthCalledWith(1, agents[0], chunks[0]);
        expect(executeSpy).toHaveBeenNthCalledWith(2, agents[1], chunks[1]);
        expect(executeSpy).toHaveBeenNthCalledWith(3, agents[2], chunks[2]);

        // Verify markDeltaProcessed called for all 35 deltas
        expect(agentService.markDeltaProcessed).toHaveBeenCalledTimes(35);
    });
});
