import { eventBusService } from './eventBusService.js';
import { agentService } from './agentService.js';
import { contextService } from './contextService.js';
import { systemPromptService } from './systemPromptService.js';
import { ACTIVATION_PROMPT } from '../symbolic_system/activation_prompt.js';
import { 
    sendMessageAndHandleTools, 
    getChatSession, 
    extractJson, 
    processMessageAsync,
    callFastInference 
} from './inferenceService.js';
import { createToolExecutor } from './toolsService.js';
import { settingsService } from './settingsService.js';
import { loggerService, LogCategory } from './loggerService.js';
import { MonitoringDelta, AgentDefinition } from '../types.js';
import { symbolCacheService } from './symbolCacheService.js';
import { tentativeLinkService } from './tentativeLinkService.js';

class AgentRunner {
    private isProcessingBatch = false;
    private pendingBatches = new Map<string, MonitoringDelta[]>(); // agentId -> deltas[]
    private routedDeltas = new Set<string>(); // deltaId (to prevent double routing in same cycle)

    constructor() {
        // Listen for new world-monitoring deltas
        eventBusService.on('monitoring:delta-created' as any, (delta: MonitoringDelta) => {
            this.handleIncomingDelta(delta);
        });

        // Background: Trigger the Batch Execution Round every 5 minutes
        setInterval(() => this.runBatchRound(), 5 * 60 * 1000);

        // Perception Promotion
        eventBusService.onKernelEvent('perception:spike-promoted' as any, (data) => {
            this.handlePromotedPerception(data);
        });

        // Initial catch-up and first batch run
        setTimeout(() => this.catchUpAndRoute(), 10000);
    }

    private lastPromotionTime = 0;
    private readonly PROMOTION_COOLDOWN_MS = 60000; // 1 minute rate limit

    private async handlePromotedPerception(data: any) {
        const now = Date.now();
        if (now - this.lastPromotionTime < this.PROMOTION_COOLDOWN_MS) {
            loggerService.catDebug(LogCategory.AGENT, `Rate-limiting perception promotion: ${data.synthesis}`);
            return;
        }
        
        this.lastPromotionTime = now;
        loggerService.catInfo(LogCategory.AGENT, `Autonomous Reaction Triggered: ${data.synthesis}`);
        
        // Find or create a SINGLE persistent autonomous situational context
        const sessions = await contextService.listSessions();
        let session = sessions.find(s => s.metadata?.kind === 'autonomous_reaction');
        
        if (!session) {
            session = await contextService.createSession('agent', { 
                kind: 'autonomous_reaction',
                source: 'perception_spike'
            }, "Autonomous Reasoning Stream");
        }

        const sessionId = session.id;

        // Format scene data for pretty display in chat (collapsed markdown)
        const sceneDataJson = JSON.stringify(data.sceneSnapshot, null, 2);
        const formattedSceneData = `
<details>
<summary>View Perception Telemetry Data</summary>

\`\`\`json
${sceneDataJson}
\`\`\`
</details>
`;

        const toolExecutor = createToolExecutor(sessionId);
        const systemPrompt = await systemPromptService.loadPrompt(ACTIVATION_PROMPT);
        const augmentedMessage = `${data.synthesis}\n\n${formattedSceneData}`;

        processMessageAsync(sessionId, augmentedMessage, toolExecutor, systemPrompt, undefined, { is_autonomous: true });
    }

    private async catchUpAndRoute() {
        try {
            const history = await contextService.getUnfilteredHistory('monitoring' as any); // Special ID for global monitor
            if (!history) return;

            // Simple catch-up: process deltas from the last 15 minutes that haven't been routed
            // In a real system, we'd track the last processed delta ID.
        } catch (e) { }
        
        this.runBatchRound();
    }

    /**
     * Immediate Routing: When a delta arrives, determine who SHOULD handle it.
     */
    private async handleIncomingDelta(delta: MonitoringDelta) {
        if (this.routedDeltas.has(delta.id)) return;

        try {
            const settings = await settingsService.getMonitoringSettings();
            if (!settings.enabled) {
                loggerService.catDebug(LogCategory.AGENT, `Ignoring incoming delta ${delta.id}: World monitoring is OFF.`);
                return;
            }

            this.routedDeltas.add(delta.id);
            const agents = await agentService.listAgents();
            const activeAgents = agents.filter(a => a.enabled && a.subscriptions && a.subscriptions.length > 0);

            if (activeAgents.length === 0) return;

            // WINNER TAKES ALL ROUTING
            const winner = await this.routeDeltaToBestAgent(activeAgents, delta);

            if (winner) {
                loggerService.catDebug(LogCategory.AGENT, `Routing: Delta ${delta.id} assigned to agent ${winner.id}`);
                const batch = this.pendingBatches.get(winner.id) || [];
                batch.push(delta);
                this.pendingBatches.set(winner.id, batch);
            } else {
                // If no one wants it, mark it as processed so we don't try again
                for (const agent of activeAgents) {
                    await agentService.markDeltaProcessed(agent.id, delta.id);
                }
            }
        } catch (error) {
            loggerService.catError(LogCategory.AGENT, "WTA Routing failed", { error });
        }
    }

    private async runBatchRound() {
        if (this.isProcessingBatch) return;
        this.isProcessingBatch = true;

        try {
            const agents = await agentService.listAgents();
            const workloads = Array.from(this.pendingBatches.entries());
            this.pendingBatches.clear();

            if (workloads.length === 0) return;

            loggerService.catInfo(LogCategory.AGENT, `Autonomous Batch Execution starting for ${workloads.length} agents...`);

            await Promise.all(workloads.map(async ([agentId, deltas]) => {
                const agent = agents.find(a => a.id === agentId);
                if (agent && deltas.length > 0) {
                    try {
                        await this.executeAgentBatchTurn(agent, deltas);
                        // Mark all as processed after success
                        for (const d of deltas) {
                            await agentService.markDeltaProcessed(agent.id, d.id);
                        }
                    } catch (e: any) {
                        loggerService.catError(LogCategory.AGENT, `Agent ${agentId} batch execution failed`, { error: e.message });
                        // Re-queue on failure? For now, we just log.
                    }
                }
            }));
        } finally {
            this.isProcessingBatch = false;
        }
    }

    private async routeDeltaToBestAgent(agents: AgentDefinition[], delta: MonitoringDelta): Promise<AgentDefinition | null> {
        const agentMetadata = agents.map(a => ({ id: a.id, subscriptions: a.subscriptions }));
        const prompt = `### AUTONOMOUS DELTA ROUTER (WTA)
Route this "World Delta" to the SINGLE most appropriate agent.

WORLD DELTA:
${delta.content.slice(0, 2000)}

AVAILABLE AGENTS:
${JSON.stringify(agentMetadata, null, 2)}

Return JSON: { "winnerId": "agent_id_here", "reason": "..." } or null.`;

        try {
            const fastText = await callFastInference([{ role: "user", content: prompt }], 200);
            const result = await extractJson(fastText);
            return result.winnerId ? agents.find(a => a.id === result.winnerId) || null : null;
        } catch (e) { return null; }
    }

    private async executeAgentBatchTurn(agent: AgentDefinition, deltas: MonitoringDelta[]) {
        try {
            const contexts = await contextService.listSessions();
            let session = contexts.find(c => c.name === `Agent: ${agent.id}` && c.status === 'open');

            if (!session) {
                session = await contextService.createSession('agent', {}, `Agent: ${agent.id}`);
            }

            const settings = await settingsService.getInferenceSettings();
            const activeSystemPrompt = await systemPromptService.loadPrompt(agent.prompt || ACTIVATION_PROMPT);
            const agentModel = settings.agentModel || settings.model;

            const chat = await getChatSession(activeSystemPrompt, session.id, agentModel);
            
            // Increment turns AFTER load (consistent with processMessageAsync)
            await symbolCacheService.incrementTurns(session.id);
            await tentativeLinkService.incrementTurns();

            const toolExecutor = createToolExecutor(session.id);

            const deltaSummary = deltas.map((d, i) => {
                let header = `[EVENT ${i + 1}]\nSource: ${d.sourceId}\nContent: ${d.content}`;
                if (d.metadata) {
                    header += `\nMetadata: ${JSON.stringify(d.metadata)}`;
                }
                return header;
            }).join('\n\n---\n\n');

            const message = `### AUTONOMOUS BATCH INGESTION\n\nThe following world deltas have been routed to your operational theater. Synthesize this information, update your internal symbolic state if necessary, and take action if required.\n\n${deltaSummary}`;

            loggerService.catInfo(LogCategory.AGENT, `Dispatching batch to Agent ${agent.id}`, { deltaCount: deltas.length, sessionId: session.id });

            const stream = sendMessageAndHandleTools(chat, message, toolExecutor, false, activeSystemPrompt, session.id, undefined, undefined, undefined, undefined, 1, message, [], { is_autonomous: true });
            
            for await (const _chunk of stream) {
                // Potential future: log or process assistant response chunks
            }
        } catch (error: any) {
            loggerService.catError(LogCategory.AGENT, `Failed to execute batch for agent ${agent.id}`, { error: error.message });
        }
    }
}

export const agentRunner = new AgentRunner();
