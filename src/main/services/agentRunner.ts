import { eventBusService, KernelEventType } from './eventBusService.js';
import { agentService } from './agentService.js';
import { contextService } from './contextService.js';
import { systemPromptService } from './systemPromptService.js';
import { ACTIVATION_PROMPT } from '../symbolic_system/activation_prompt.js';
import { sendMessageAndHandleTools, getChatSession, getGeminiClient, getClient, extractJson, processMessageAsync } from './inferenceService.js';
import { createToolExecutor } from './toolsService.js';
import { settingsService } from './settingsService.js';
import { loggerService, LogCategory } from './loggerService.js';
import { MonitoringDelta, AgentDefinition } from '../types.js';
import { broadcast } from '../index.js';

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

        const prompt = `
[Situational Awareness Update]
Event: ${data.synthesis}
Evaluation Reason: ${data.reason}
Recent Context: ${data.transcriptSlice}

TASK: Based on this new awareness, provide a brief, helpful intervention or observation.
Keep it concise and high-signal. Use tools if a concrete problem is detected.
`.trim();

        // Trigger a high-priority agent round
        const toolExecutor = createToolExecutor(session.id);
        const settings = await settingsService.getInferenceSettings();
        
        // Switch UI to this new autonomous context
        broadcast('navigate', 'chat');
        broadcast('kernel:event', { type: 'context:selected', data: { sessionId: session.id } });

        processMessageAsync(session.id, prompt, toolExecutor, settings.systemName || 'axiom', undefined, {
            voice_authenticated_username: 'SYSTEM'
        });
    }

    /**
     * Initial catch-up: finds deltas that arrived while offline and routes them.
     */
    private async catchUpAndRoute() {
        try {
            const settings = await settingsService.getMonitoringSettings();
            if (!settings.enabled) {
                loggerService.catDebug(LogCategory.AGENT, "Monitoring disabled; skipping catch-up routing.");
                return;
            }

            const agents = await agentService.listAgents();
            const activeAgents = agents.filter(a => a.enabled && a.subscriptions && a.subscriptions.length > 0);
            if (activeAgents.length === 0) return;

            // Use the first agent as a proxy to find recently arrived, unprocessed deltas
            const unprocessed = await agentService.getUnprocessedDeltas(activeAgents[0].id, 20);
            if (unprocessed.length > 0) {
                loggerService.catInfo(LogCategory.AGENT, `Routing ${unprocessed.length} caught-up deltas...`);
                for (const delta of unprocessed) {
                    await this.handleIncomingDelta(delta as MonitoringDelta);
                }
            }

            // Trigger first batch run immediately after catch-up routing
            this.runBatchRound();
        } catch (error) {
            loggerService.catError(LogCategory.AGENT, "Catch-up routing failed", { error });
        }
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

    /**
     * Batch Execution Round: Every 5 minutes, all agents with pending deltas run a turn.
     * We chunk these into groups of 15 to avoid overwhelming the model.
     */
    private async runBatchRound() {
        if (this.isProcessingBatch) return;

        try {
            this.isProcessingBatch = true;
            const agents = await agentService.listAgents();
            const BATCH_CHUNK_SIZE = 15;

            for (const agent of agents) {
                const deltas = this.pendingBatches.get(agent.id);
                if (!deltas || deltas.length === 0) continue;

                loggerService.catInfo(LogCategory.AGENT, `Batch Round: Agent ${agent.id} has ${deltas.length} deltas pending.`);

                // Clear the pending batch before starting
                this.pendingBatches.set(agent.id, []);

                // Process in chunks of 15
                for (let i = 0; i < deltas.length; i += BATCH_CHUNK_SIZE) {
                    const chunk = deltas.slice(i, i + BATCH_CHUNK_SIZE);
                    loggerService.catInfo(LogCategory.AGENT, `Agent ${agent.id}: Processing chunk ${Math.floor(i / BATCH_CHUNK_SIZE) + 1} (${chunk.length} deltas)`);

                    try {
                        await this.executeAgentBatchTurn(agent, chunk);

                        // Mark this chunk as processed in DB
                        for (const delta of chunk) {
                            await agentService.markDeltaProcessed(agent.id, delta.id);
                            this.routedDeltas.delete(delta.id);
                        }
                    } catch (err) {
                        loggerService.catError(LogCategory.AGENT, `Chunk execution failed for agent ${agent.id}`, { error: err });
                        // Re-add failed deltas to the front of the batch for next round?
                        // For now we skip them to avoid infinite failure loops.
                    }
                }
            }
        } finally {
            this.isProcessingBatch = false;
        }
    }

    private async routeDeltaToBestAgent(agents: AgentDefinition[], delta: MonitoringDelta): Promise<AgentDefinition | null> {
        const settings = await settingsService.getInferenceSettings();
        const fastModel = settings.fastModel;
        if (!fastModel) return null;

        const agentMetadata = agents.map(a => ({ id: a.id, subscriptions: a.subscriptions }));
        const prompt = `### AUTONOMOUS DELTA ROUTER (WTA)
Route this "World Delta" to the SINGLE most appropriate agent.

WORLD DELTA:
${delta.content.slice(0, 2000)}

AVAILABLE AGENTS:
${JSON.stringify(agentMetadata, null, 2)}

Return JSON: { "winnerId": "agent_id_here", "reason": "..." } or null.`;

        try {
            let result: any = {};
            if (settings.provider === 'gemini') {
                const client = await getGeminiClient();
                const model = client.getGenerativeModel({ model: fastModel, generationConfig: { maxOutputTokens: 200, temperature: 0.1 } });
                const response = await model.generateContent(prompt);
                result = await extractJson(response.response.text());
            } else {
                const client = await getClient();
                const response = await client.chat.completions.create({ model: fastModel, messages: [{ role: "user", content: prompt }], max_tokens: 200, temperature: 0.1 });
                result = await extractJson(response.choices[0]?.message?.content || "{}");
            }
            return result.winnerId ? agents.find(a => a.id === result.winnerId) || null : null;
        } catch (e) { return null; }
    }

    private async executeAgentBatchTurn(agent: AgentDefinition, deltas: MonitoringDelta[]) {
        try {
            const contexts = await contextService.listSessions();
            let session = contexts.find(c => c.name === `Agent: ${agent.id}` && c.status === 'open');
            if (!session) {
                session = await contextService.createSession('agent', {}, `Agent: ${agent.id}`);
                eventBusService.emitKernelEvent(KernelEventType.CONTEXT_CREATED, session);
            }
            if (!session) throw new Error("Failed to create agent session");

            const settings = await settingsService.getInferenceSettings();
            const agentModel = settings.agentModel || settings.model;
            const baseSystemPrompt = await systemPromptService.loadPrompt(ACTIVATION_PROMPT);
            const fullAgentPrompt = `${baseSystemPrompt}\n\n[AGENT_SPECIFIC_PROTOCOL]\n${agent.prompt}`;

            const chat = await getChatSession(fullAgentPrompt, session.id, agentModel);
            const toolExecutor = createToolExecutor(session.id);

            const deltaSummary = deltas.map((d, i) => {
                let header = `[EVENT ${i + 1}]\nSource: ${d.sourceId}\nContent: ${d.content}`;
                if (d.metadata) {
                    if (d.metadata.articleUrl) header += `\nArticle URL: ${d.metadata.articleUrl}`;
                    if (d.metadata.imageUrl) header += `\nImage URL: ${d.metadata.imageUrl}`;
                }
                return header;
            }).join('\n\n---\n\n');

            const message = `[AUTONOMOUS BATCH TRIGGER]\n${deltas.length} new events have been detected:\n\n${deltaSummary}\n\nSynthesize these events into your symbolic graph. Use the provided URLs for grounding if needed.  You MUST modify the symbolic graph using the upsert_symbols tool for each delta.  You MUST use the log_trace tool to record the changes.`;

            const startTime = new Date().toISOString();
            const stream = sendMessageAndHandleTools(chat, message, toolExecutor, false, fullAgentPrompt, session.id, undefined, undefined, undefined, undefined, 0);

            let fullResponse = "";
            let traceCount = 0;
            for await (const chunk of stream) {
                if (chunk.text) {
                    fullResponse += chunk.text;
                    eventBusService.emitKernelEvent(KernelEventType.INFERENCE_CHUNK, { sessionId: session.id, text: chunk.text });
                }
                if (chunk.toolCalls) {
                    for (const call of chunk.toolCalls) {
                        if (call.function?.name === 'log_trace') traceCount++;
                    }
                }
            }

            eventBusService.emitKernelEvent(KernelEventType.INFERENCE_COMPLETED, { sessionId: session.id });
            await agentService.logExecution({
                agentId: agent.id,
                startedAt: startTime,
                finishedAt: new Date().toISOString(),
                status: 'completed',
                traceCount,
                responsePreview: fullResponse.slice(0, 200).replace(/\n/g, ' ').trim()
            });
        } catch (error: any) {
            loggerService.catError(LogCategory.AGENT, `Batch turn failed for ${agent.id}`, { error: error.message });
        }
    }
}

export const agentRunner = new AgentRunner();
