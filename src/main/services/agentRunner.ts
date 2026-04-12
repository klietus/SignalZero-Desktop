import { eventBusService, KernelEventType } from './eventBusService.js';
import { agentService } from './agentService.js';
import { contextService } from './contextService.js';
import { systemPromptService } from './systemPromptService.js';
import { ACTIVATION_PROMPT } from '../symbolic_system/activation_prompt.js';
import { sendMessageAndHandleTools, getChatSession, getGeminiClient, getClient, extractJson } from './inferenceService.js';
import { createToolExecutor } from './toolsService.js';
import { settingsService } from './settingsService.js';
import { loggerService, LogCategory } from './loggerService.js';
import { MonitoringDelta, AgentDefinition } from '../types.js';

class AgentRunner {
    private isGating = false;
    private processingDeltas = new Set<string>(); // "deltaId"

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
            
            if (activeAgents.length === 0) return;

            // Simple catchup logic: get the 5 most recent deltas and route them
            // In a real WTA scenario, catchup is slightly different but we follow the same routing logic.
            const allUnprocessed = await agentService.getUnprocessedDeltas(activeAgents[0].id, 5); // Just a heuristic to get recently arrived deltas
            
            for (const delta of allUnprocessed) {
                await this.handleNewDelta(delta as MonitoringDelta);
            }
        } catch (error) {
            loggerService.catError(LogCategory.AGENT, "Catch-up processing failed", { error });
        }
    }

    private async handleNewDelta(delta: MonitoringDelta) {
        if (this.isGating) return;
        if (this.processingDeltas.has(delta.id)) return;

        try {
            this.isGating = true;
            this.processingDeltas.add(delta.id);

            const agents = await agentService.listAgents();
            const activeAgents = agents.filter(a => a.enabled && a.subscriptions && a.subscriptions.length > 0);
            
            if (activeAgents.length === 0) {
                // No one can handle this, mark as "processed" globally (simulated by marking for all agents)
                // In this simplified WTA model, we just stop.
                return;
            }

            // --- WINNER TAKES ALL ROUTING ---
            const winner = await this.routeDeltaToBestAgent(activeAgents, delta);

            if (winner) {
                loggerService.catInfo(LogCategory.AGENT, `WTA Routing: Delta ${delta.id} routed to agent ${winner.id}`);
                await this.executeAgentTurn(winner, delta);
            } else {
                loggerService.catDebug(LogCategory.AGENT, `WTA Routing: No relevant agent found for delta ${delta.id}`);
            }

            // Mark this delta as processed for ALL active agents to prevent redundant routing attempts
            for (const agent of activeAgents) {
                await agentService.markDeltaProcessed(agent.id, delta.id);
            }

        } catch (error) {
            loggerService.catError(LogCategory.AGENT, "Neural Gating / WTA Routing failed", { error });
        } finally {
            this.isGating = false;
            this.processingDeltas.delete(delta.id);
        }
    }

    /**
     * WTA Router (0.8B Model)
     * Evaluates all agents and selects the SINGLE best one to handle the delta.
     */
    private async routeDeltaToBestAgent(agents: AgentDefinition[], delta: MonitoringDelta): Promise<AgentDefinition | null> {
        const settings = await settingsService.getInferenceSettings();
        const fastModel = settings.fastModel;
        if (!fastModel) return null;

        const agentMetadata = agents.map(a => ({
            id: a.id,
            subscriptions: a.subscriptions
        }));

        const prompt = `### AUTONOMOUS DELTA ROUTER (WTA)

You are the central nervous system of a symbolic reasoning kernel.
Your goal is to route the following "World Delta" to the SINGLE most appropriate agent.

WORLD DELTA:
${delta.content.slice(0, 3000)}

AVAILABLE AGENTS & SUBSCRIPTIONS:
${JSON.stringify(agentMetadata, null, 2)}

#### MISSION GOAL:
Select the ONE agent whose subscriptions and expertise most closely align with this delta. If multiple agents match, choose the most specific one. If NO agents are relevant, set "winnerId" to null.

#### OUTPUT SCHEMA:
{
  "winnerId": "agent_id_here",
  "reason": "Brief explanation of why this agent is the best fit."
}`;

        try {
            let result: any = {};
            if (settings.provider === 'gemini') {
                const client = await getGeminiClient();
                const model = client.getGenerativeModel({ 
                    model: fastModel,
                    generationConfig: { maxOutputTokens: 200, temperature: 0.1 }
                });
                const response = await model.generateContent(prompt);
                result = extractJson(response.response.text());
            } else {
                const client = await getClient();
                const response = await client.chat.completions.create({
                    model: fastModel,
                    messages: [{ role: "user", content: prompt }],
                    max_tokens: 200,
                    temperature: 0.1
                });
                result = extractJson(response.choices[0]?.message?.content || "{}");
            }

            if (result.winnerId) {
                return agents.find(a => a.id === result.winnerId) || null;
            }
            return null;
        } catch (e) {
            loggerService.catError(LogCategory.AGENT, "WTA Router model failure", { error: e });
            return null;
        }
    }

    private async executeAgentTurn(agent: AgentDefinition, delta: MonitoringDelta) {
        try {
            // 1. Ensure a dedicated OPEN context session exists for this agent
            const contexts = await contextService.listSessions();
            let session = contexts.find(c => c.name === `Agent: ${agent.id}` && c.status === 'open');
            
            if (!session) {
                session = await contextService.createSession('agent', {}, `Agent: ${agent.id}`);
                eventBusService.emitKernelEvent(KernelEventType.CONTEXT_CREATED, session);
            }

            if (!session) throw new Error("Failed to create agent context session");

            // 2. Setup inference session
            const settings = await settingsService.getInferenceSettings();
            const agentModel = settings.agentModel || settings.model;
            
            const baseSystemPrompt = await systemPromptService.loadPrompt(ACTIVATION_PROMPT);
            const fullAgentPrompt = `${baseSystemPrompt}\n\n[AGENT_SPECIFIC_PROTOCOL]\n${agent.prompt}`;

            const chat = await getChatSession(fullAgentPrompt, session.id, agentModel);
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
            let traceCount = 0;
            for await (const chunk of stream) {
                if (chunk.text) {
                    fullResponse += chunk.text;
                    eventBusService.emitKernelEvent(KernelEventType.INFERENCE_CHUNK, { 
                        sessionId: session.id, 
                        text: chunk.text 
                    });
                }
                
                if (chunk.toolCalls) {
                    for (const call of chunk.toolCalls) {
                        if (call.function?.name === 'log_trace') {
                            traceCount++;
                        }
                    }
                }
            }

            eventBusService.emitKernelEvent(KernelEventType.INFERENCE_COMPLETED, { sessionId: session.id });

            // 4. Log to agent audit trail
            await agentService.logExecution({
                agentId: agent.id,
                startedAt: startTime,
                finishedAt: new Date().toISOString(),
                status: 'completed',
                traceCount,
                responsePreview: fullResponse.slice(0, 200).replace(/\n/g, ' ').trim()
            });

        } catch (error: any) {
            loggerService.catError(LogCategory.AGENT, `Agent turn failed for ${agent.id}`, { error: error.message });
        }
    }
}

export const agentRunner = new AgentRunner();
