import { eventBusService, KernelEventType } from './eventBusService.js';
import { agentService } from './agentService.js';
import { contextService } from './contextService.js';
import { sendMessageAndHandleTools, getChatSession, getGeminiClient, getClient, extractJson } from './inferenceService.js';
import { createToolExecutor } from './toolsService.js';
import { settingsService } from './settingsService.js';
import { loggerService, LogCategory } from './loggerService.js';
import { MonitoringDelta, AgentDefinition } from '../types.js';

class AgentRunner {
    private isGating = false;
    private processingDeltas = new Set<string>(); // "agentId:deltaId"

    constructor() {
        // Listen for new world-monitoring deltas
        eventBusService.on('monitoring:delta-created' as any, (delta: MonitoringDelta) => {
            this.handleNewDelta(delta);
        });

        // Background: catch up on any missed deltas every 5 minutes
        setInterval(() => this.resumeProcessing(), 5 * 60 * 1000);
        // Also run once at startup after a short delay
        setTimeout(() => this.resumeProcessing(), 10000);
    }

    private async resumeProcessing() {
        if (this.isGating) return;
        
        try {
            const agents = await agentService.listAgents();
            const activeAgents = agents.filter(a => a.enabled && a.subscriptions && a.subscriptions.length > 0);
            
            for (const agent of activeAgents) {
                // Get up to 5 unprocessed deltas per catch-up cycle to prevent GPU overload
                const unprocessed = await agentService.getUnprocessedDeltas(agent.id, 5);
                if (unprocessed.length > 0) {
                    loggerService.catInfo(LogCategory.AGENT, `Agent ${agent.id} catching up on ${unprocessed.length} deltas`);
                    for (const delta of unprocessed) {
                        await this.handleNewDelta(delta as MonitoringDelta, agent);
                    }
                }
            }
        } catch (error) {
            loggerService.catError(LogCategory.AGENT, "Catch-up processing failed", { error });
        }
    }

    private async handleNewDelta(delta: MonitoringDelta, specificAgent?: AgentDefinition) {
        if (this.isGating && !specificAgent) return; // Only allow specificAgent (catch-up) or first-time
        
        try {
            const agents = specificAgent ? [specificAgent] : await agentService.listAgents();
            const activeAgents = agents.filter(a => a.enabled && a.subscriptions && a.subscriptions.length > 0);
            
            if (activeAgents.length === 0) return;

            for (const agent of activeAgents) {
                const lockKey = `${agent.id}:${delta.id}`;
                
                // 1. Double check we haven't already processed this or aren't CURRENTLY processing it
                const alreadyDone = await agentService.isDeltaProcessed(agent.id, delta.id);
                if (alreadyDone || this.processingDeltas.has(lockKey)) continue;

                // 2. Lock it
                this.processingDeltas.add(lockKey);

                try {
                    // 3. Perform Neural Gating
                    const shouldWake = await this.vibeCheck(agent, delta);
                    if (shouldWake) {
                        loggerService.catInfo(LogCategory.AGENT, `Gating PASS: Agent ${agent.id} waking for delta ${delta.id}`);
                        await this.executeAgentTurn(agent, delta);
                    }

                    // 4. Mark as processed even if Vibe Check failed (to avoid redundant checks)
                    await agentService.markDeltaProcessed(agent.id, delta.id);
                } finally {
                    // 5. Always release the in-memory lock
                    this.processingDeltas.delete(lockKey);
                }
            }
        } catch (error) {
            loggerService.catError(LogCategory.AGENT, "Neural Gating failed", { error });
        }
    }

    /**
     * The Gating Layer (0.8B Vibe Check)
     * Extremely lightweight check to see if we should spend GPU cycles on a full turn.
     */
    private async vibeCheck(agent: AgentDefinition, delta: MonitoringDelta): Promise<boolean> {
        const settings = await settingsService.getInferenceSettings();
        const fastModel = settings.fastModel;
        if (!fastModel) return false;

        const prompt = `Neural Gating Protocol. 
        Agent Subscriptions: ${JSON.stringify(agent.subscriptions)}
        New World Delta: ${delta.content.slice(0, 2000)}

        Question: Does this delta contain information that matches or is highly relevant to the agent's subscriptions? 
        Respond with JSON: { "relevant": boolean, "reason": "short explanation" }`;

        try {
            let result: any = {};
            if (settings.provider === 'gemini') {
                const client = await getGeminiClient();
                const model = client.getGenerativeModel({ model: fastModel });
                const response = await model.generateContent(prompt);
                result = extractJson(response.response.text());
            } else {
                const client = await getClient();
                const response = await client.chat.completions.create({
                    model: fastModel,
                    messages: [{ role: "user", content: prompt }],
                    max_tokens: 100
                });
                result = extractJson(response.choices[0]?.message?.content || "{}");
            }
            return !!result.relevant;
        } catch (e) {
            return false;
        }
    }

    private async executeAgentTurn(agent: AgentDefinition, delta: MonitoringDelta) {
        try {
            // 1. Ensure a dedicated OPEN context session exists for this agent
            const contexts = await contextService.listSessions();
            // Only find 'open' sessions. If it's closed/archived, we ignore it and create a fresh one.
            let session = contexts.find(c => c.name === `Agent: ${agent.id}` && c.status === 'open');
            
            if (!session) {
                session = await contextService.createSession('agent', {}, `Agent: ${agent.id}`);
                // Notify UI that a new context was created so it appears in the sidebar
                eventBusService.emitKernelEvent(KernelEventType.CONTEXT_CREATED, session);
            }

            if (!session) throw new Error("Failed to create agent context session");

            // 2. Setup inference session
            const settings = await settingsService.getInferenceSettings();
            const agentModel = settings.agentModel || settings.model;
            
            const chat = await getChatSession(agent.prompt, session.id, agentModel);
            const toolExecutor = createToolExecutor(session.id);

            const message = `[AUTONOMOUS EVENT TRIGGER]\nA new delta has been detected: \n\nSource: ${delta.sourceId}\nContent: ${delta.content}\n\nExecute your cognitive protocol based on this event. Use tools if necessary to investigate or update the symbolic graph.`;

            const startTime = new Date().toISOString();
            
            // 3. Start reasoning turn (Priority 0 = Background)
            const stream = sendMessageAndHandleTools(
                chat, 
                message, 
                toolExecutor, 
                true, // Always trace agent actions
                agent.prompt,
                session.id, 
                undefined,
                undefined,
                undefined,
                undefined,
                0 // PRIORITY: LOW (Background)
            );

            let fullResponse = "";
            for await (const chunk of stream) {
                if (chunk.text) {
                    fullResponse += chunk.text;
                    // Stream progress to the UI if this context is currently active
                    eventBusService.emitKernelEvent(KernelEventType.INFERENCE_CHUNK, { 
                        sessionId: session.id, 
                        text: chunk.text 
                    });
                }
            }

            eventBusService.emitKernelEvent(KernelEventType.INFERENCE_COMPLETED, { sessionId: session.id });

            // 4. Log to agent audit trail
            await agentService.logExecution({
                agentId: agent.id,
                startedAt: startTime,
                finishedAt: new Date().toISOString(),
                status: 'completed',
                traceCount: 0,
                responsePreview: fullResponse.slice(0, 200)
            });

        } catch (error: any) {
            loggerService.catError(LogCategory.AGENT, `Agent turn failed for ${agent.id}`, { error: error.message });
        }
    }
}

export const agentRunner = new AgentRunner();
