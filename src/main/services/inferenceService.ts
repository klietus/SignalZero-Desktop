import OpenAI from "openai";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { randomUUID } from "crypto";
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
  ChatCompletionAssistantMessageParam,
} from "openai/resources/chat/completions";
import { PRIMARY_TOOLS } from "./toolsService.js";
import { ContextMessage, SymbolDef } from "../types.js";
import { settingsService } from "./settingsService.js";
import { contextService } from './contextService.js';
import { symbolCacheService } from './symbolCacheService.js';
import { contextWindowService } from './contextWindowService.js';
import { loggerService, LogCategory } from './loggerService.js';
import { domainService } from './domainService.js';
import { eventBusService, KernelEventType } from './eventBusService.js';

interface ChatSessionState {
  messages: ChatCompletionMessageParam[];
  systemInstruction: string;
  model: string;
}

const MAX_TOOL_LOOPS = 15;
const MAX_AUDIT_RETRIES = 3;

export const getClient = async () => {
  const { endpoint, provider, apiKey } = await settingsService.getInferenceSettings();

  if (provider === 'openai') {
    return new OpenAI({ baseURL: 'https://api.openai.com/v1', apiKey: apiKey });
  }

  if (provider === 'kimi2') {
    return new OpenAI({ baseURL: 'https://api.moonshot.ai/v1', apiKey: apiKey });
  }

  return new OpenAI({
    baseURL: endpoint,
    apiKey: apiKey || "lm-studio",
  });
};

export const getGeminiClient = async () => {
  const { apiKey } = await settingsService.getInferenceSettings();
  return new GoogleGenerativeAI(apiKey);
};

const cleanGeminiSchema = (schema: any): any => {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(cleanGeminiSchema);
  const { additionalProperties, ...rest } = schema;
  const cleaned = { ...rest };
  if (cleaned.properties) {
    cleaned.properties = {};
    for (const [key, val] of Object.entries(schema.properties)) {
      cleaned.properties[key] = cleanGeminiSchema(val);
    }
  }
  if (cleaned.items) cleaned.items = cleanGeminiSchema(cleaned.items);
  return cleaned;
};

const toGeminiTools = (tools: any[]) => {
  return [{
    functionDeclarations: tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      parameters: cleanGeminiSchema({
        type: SchemaType.OBJECT,
        properties: t.function.parameters.properties,
        required: t.function.parameters.required,
      }),
    }))
  }];
};

const getModel = async () => (await settingsService.getInferenceSettings()).model;

const mergeToolCallDelta = (
  collected: Map<number, ChatCompletionMessageToolCall>,
  toolCalls?: any[]
) => {
  if (!toolCalls) return collected;
  for (const call of toolCalls) {
    const index = call.index ?? 0;
    const existing = collected.get(index) || {
      id: call.id ?? "",
      type: "function",
      function: { name: "", arguments: "" },
      index,
    };
    const nextArgs = call.function?.arguments ?? "";
    const nextName = call.function?.name || existing.function.name;
    collected.set(index, {
      ...existing,
      id: call.id || existing.id,
      function: {
        name: nextName,
        arguments: `${existing.function.arguments || ""}${nextArgs || ""}`,
      },
      type: "function",
      index,
    } as any);
  }
  return collected;
};

const parseToolArguments = (args: string): { data: any; error?: string } => {
  if (!args || args.trim() === "") return { data: {} };
  try { return { data: JSON.parse(args) }; }
  catch (error: any) {
    return { data: {}, error: `JSON Parse Error: ${error.message}` };
  }
};

const chatSessions = new Map<string, ChatSessionState>();

export const getChatSession = async (systemInstruction: string, contextSessionId?: string) => {
  const key = contextSessionId || "default";
  let session = chatSessions.get(key);
  if (!session || session.systemInstruction !== systemInstruction) {
    session = { messages: [{ role: "system", content: systemInstruction }], systemInstruction, model: await getModel() };
    chatSessions.set(key, session);
  }
  session.model = await getModel();
  return session;
};

export const normalizeMessages = (messages: ChatCompletionMessageParam[]): ChatCompletionMessageParam[] => {
  const normalized: ChatCompletionMessageParam[] = [];
  let systemContent = "";
  const otherMessages = messages.filter(m => {
    if (m.role === 'system') {
      systemContent += (systemContent ? "\n\n" : "") + m.content;
      return false;
    }
    return true;
  });
  if (systemContent) normalized.push({ role: 'system', content: systemContent });
  for (const msg of otherMessages) {
    const last = normalized[normalized.length - 1];
    if (last && last.role === msg.role && last.role !== 'tool' && !('tool_calls' in last) && !('tool_calls' in msg)) {
      last.content = (String(last.content || "") + "\n\n" + String(msg.content || "")).trim();
      continue;
    }
    normalized.push(msg);
  }
  return normalized;
};

const streamAssistantResponse = async function* (
  messages: ChatCompletionMessageParam[],
  model: string,
  activeTools: ChatCompletionTool[] = PRIMARY_TOOLS
): AsyncGenerator<{ text?: string; toolCalls?: ChatCompletionMessageToolCall[]; assistantMessage?: ChatCompletionMessageParam; }> {
  const settings = await settingsService.getInferenceSettings();
  
  if (settings.provider === 'gemini') {
    const client = await getGeminiClient();
    const geminiTools = toGeminiTools(activeTools);
    
    // Gemini 3 Thinking Support
    const isGemini3 = model.includes('gemini-3');
    const geminiModel = client.getGenerativeModel({
        model: model,
        tools: geminiTools
    }, {
        ...(isGemini3 ? {
            thinkingConfig: {
                include_thought: false,
                thinking_level: 'high'
            }
        } : {})
    } as any);

    const systemMessage = messages.find(m => m.role === 'system');
    const history: any[] = [];
    const nonSystem = messages.filter(m => m.role !== 'system');
    
    for (let i = 0; i < nonSystem.length - 1; i++) {
        const m = nonSystem[i];
        if (m.role === 'user') {
            history.push({ role: 'user', parts: [{ text: String(m.content) }] });
        } else if (m.role === 'assistant') {
            const parts: any[] = [];
            if (m.content) parts.push({ text: String(m.content) });
            if (m.tool_calls) {
                parts.push(...m.tool_calls.map(tc => ({
                    functionCall: {
                        name: tc.function.name,
                        args: JSON.parse(tc.function.arguments)
                    }
                })));
            }
            history.push({ role: 'model', parts });
        } else if (m.role === 'tool') {
            history.push({
                role: 'user', 
                parts: [{
                    functionResponse: {
                        name: (m as any).name || 'tool',
                        response: { result: m.content }
                    }
                }]
            });
        }
    }

    const chat = geminiModel.startChat({ 
        history, 
        systemInstruction: systemMessage?.content ? String(systemMessage.content) : undefined 
    });
    
    const lastMsg = nonSystem[nonSystem.length - 1];
    let result;
    if (lastMsg.role === 'user') {
        result = await chat.sendMessageStream(String(lastMsg.content));
    } else if (lastMsg.role === 'tool') {
        result = await chat.sendMessageStream([{
            functionResponse: {
                name: (lastMsg as any).name || 'tool',
                response: { result: lastMsg.content }
            }
        }]);
    } else {
        result = await chat.sendMessageStream("Continue");
    }

    let textAcc = "";
    const toolCalls: ChatCompletionMessageToolCall[] = [];

    let inThinkBlock = false;
    let currentThinkTag = "";

    for await (const chunk of result.stream) {
      const parts = chunk.candidates?.[0]?.content?.parts;
      if (parts) {
          for (const part of parts) {
              if (part.text) {
                  let textToProcess = part.text;
                  let processedText = "";
                  
                  let i = 0;
                  while (i < textToProcess.length) {
                    if (!inThinkBlock) {
                      const remaining = textToProcess.slice(i);
                      const thinkMatch = remaining.match(/^<(think|thought)>/i);
                      if (thinkMatch) {
                        inThinkBlock = true;
                        currentThinkTag = thinkMatch[1].toLowerCase();
                        i += thinkMatch[0].length;
                        continue;
                      }
                      processedText += textToProcess[i];
                      i++;
                    } else {
                      const remaining = textToProcess.slice(i);
                      const endMatch = remaining.match(new RegExp(`^</${currentThinkTag}>`, "i"));
                      if (endMatch) {
                        inThinkBlock = false;
                        currentThinkTag = "";
                        i += endMatch[0].length;
                        continue;
                      }
                      i++;
                    }
                  }

                  if (processedText) {
                    textAcc += processedText;
                    yield { text: processedText };
                  }
              }
              if (part.functionCall) {
                  toolCalls.push({
                      id: randomUUID(),
                      type: 'function',
                      function: {
                          name: part.functionCall.name,
                          arguments: JSON.stringify(part.functionCall.args)
                      }
                  } as any);
              }
          }
      }
    }

    yield { 
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        assistantMessage: { 
            role: "assistant", 
            content: textAcc,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined
        } 
    };
    return;
  }

  const client = await getClient();
  const stream = await client.chat.completions.create({ model, messages: normalizeMessages(messages), tools: activeTools, stream: true });
  let textAcc = "";
  const toolCalls = new Map<number, ChatCompletionMessageToolCall>();
  
  let inThinkBlock = false;
  let currentThinkTag = "";

  for await (const part of stream) {
    const delta = part.choices[0]?.delta;
    if (delta?.content) {
        let textToProcess = delta.content;
        let processedText = "";
        
        let i = 0;
        while (i < textToProcess.length) {
          if (!inThinkBlock) {
            const remaining = textToProcess.slice(i);
            const thinkMatch = remaining.match(/^<(think|thought)>/i);
            if (thinkMatch) {
              inThinkBlock = true;
              currentThinkTag = thinkMatch[1].toLowerCase();
              i += thinkMatch[0].length;
              continue;
            }
            processedText += textToProcess[i];
            i++;
          } else {
            const remaining = textToProcess.slice(i);
            const endMatch = remaining.match(new RegExp(`^</${currentThinkTag}>`, "i"));
            if (endMatch) {
              inThinkBlock = false;
              currentThinkTag = "";
              i += endMatch[0].length;
              continue;
            }
            i++;
          }
        }

        if (processedText) {
            textAcc += processedText;
            yield { text: processedText };
        }
    }
    if (delta?.tool_calls) mergeToolCallDelta(toolCalls, delta.tool_calls as any);
  }
  const completedCalls = Array.from(toolCalls.values());
  yield { toolCalls: completedCalls.length > 0 ? completedCalls : undefined, assistantMessage: { role: "assistant", content: textAcc, tool_calls: completedCalls.length > 0 ? completedCalls : undefined } };
};

export const stripThoughts = (text: string): string => {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const isNarrativeText = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith('[System') || trimmed.includes('SYSTEM AUDIT FAILURE')) return false;
    const withoutThoughts = stripThoughts(trimmed);
    return withoutThoughts.length > 2;
};

export async function* sendMessageAndHandleTools(
  chat: ChatSessionState,
  message: string,
  toolExecutor: (name: string, args: any) => Promise<any>,
  systemInstruction?: string,
  contextSessionId?: string
): AsyncGenerator<{ text?: string; toolCalls?: any[]; isComplete?: boolean }> {
  const currentCorrelationId = randomUUID();

  if (contextSessionId && message) {
    const history = await contextService.getUnfilteredHistory(contextSessionId);
    const lastUserMsg = [...history].reverse().find(m => m.role === 'user');
    
    if (!lastUserMsg || lastUserMsg.content !== message) {
        await contextService.recordMessage(contextSessionId, { 
            id: randomUUID(), 
            role: "user", 
            content: message, 
            timestamp: new Date().toISOString(),
            correlationId: currentCorrelationId
        });
        await symbolCacheService.incrementTurns(contextSessionId);
    }
  }

  let totalTextAccumulatedAcrossLoops = "";
  let previousTurnText = "";
  let hasLoggedTrace = false;
  let loops = 0;
  let auditRetries = 0;
  const transientMessages: ChatCompletionMessageParam[] = [];

  while (loops < MAX_TOOL_LOOPS) {
    const contextMessages = contextSessionId 
        ? await contextWindowService.constructContextWindow(contextSessionId, systemInstruction || chat.systemInstruction)
        : [{ role: 'system', content: systemInstruction || chat.systemInstruction }, { role: 'user', content: message }] as ChatCompletionMessageParam[];

    const finalMessages = [...contextMessages, ...transientMessages];
    const stream = streamAssistantResponse(finalMessages, chat.model);
    let textAccumulatedInTurn = "";
    let turnToolCalls: ChatCompletionMessageToolCall[] | undefined;
    let assistantMsg: ChatCompletionMessageParam | undefined;

    for await (const chunk of stream) {
      if (chunk.text) { 
        textAccumulatedInTurn += chunk.text; 
        yield { text: chunk.text }; 
        if (contextSessionId) {
            eventBusService.emitKernelEvent(KernelEventType.INFERENCE_CHUNK, { 
                sessionId: contextSessionId, 
                text: chunk.text,
                correlationId: currentCorrelationId
            });
        }
      }
      if (chunk.toolCalls) turnToolCalls = chunk.toolCalls;
      if (chunk.assistantMessage) assistantMsg = chunk.assistantMessage;
    }

    if (!assistantMsg) break;

    // Turn Deduplication
    if (loops > 0 && textAccumulatedInTurn.trim().length > 0 && textAccumulatedInTurn.trim() === previousTurnText.trim()) {
        loggerService.catWarn(LogCategory.INFERENCE, "Detected duplicate text generation (echo). Suppressing from history.", { contextSessionId });
        textAccumulatedInTurn = "";
    } else if (textAccumulatedInTurn.trim().length > 0) {
        previousTurnText = textAccumulatedInTurn;
    }

    // Sanitize tool arguments
    if (assistantMsg.role === 'assistant' && (assistantMsg as ChatCompletionAssistantMessageParam).tool_calls) {
        const assistant = assistantMsg as ChatCompletionAssistantMessageParam;
        for (const call of assistant.tool_calls!) {
            const { error } = parseToolArguments(call.function.arguments);
            if (error) {
                loggerService.catWarn(LogCategory.INFERENCE, "Detected malformed JSON in tool call. Sanitizing.", { callId: call.id, toolName: call.function.name });
                call.function.arguments = "{}";
            }
        }
    }

    totalTextAccumulatedAcrossLoops += textAccumulatedInTurn;

    // --- AUDIT INTERCEPTOR ---
    let auditTriggered = false;
    let auditMessage = "";
    const isEndingTurn = !turnToolCalls || turnToolCalls.length === 0;
    const isCallingTraceThisTurn = turnToolCalls?.some(tc => tc.function.name === 'log_trace');

    const session = contextSessionId ? await contextService.getSession(contextSessionId) : null;
    const traceNeeded = session?.metadata?.trace_needed === true;

    if (traceNeeded && isEndingTurn && !hasLoggedTrace && !isCallingTraceThisTurn) {
        auditMessage = "⚠️ SYSTEM AUDIT FAILURE: This operation requires a trace, but you failed to call `log_trace`. Call `log_trace` now. Do not repeat previous info.";
        auditTriggered = true;
    }

    const hasNarrative = isNarrativeText(totalTextAccumulatedAcrossLoops);
    if (isEndingTurn && !hasNarrative && !auditTriggered) {
        auditMessage = "⚠️ SYSTEM AUDIT FAILURE: You provided tool calls but failed to generate a narrative response for the user. Please provide your narrative output now.";
        auditTriggered = true;
    }

    if (auditTriggered && auditRetries < MAX_AUDIT_RETRIES) {
        loggerService.catWarn(LogCategory.INFERENCE, "System Audit Failure: Retrying", { contextSessionId });
        transientMessages.push(assistantMsg!);
        transientMessages.push({ role: "user", content: `[SYSTEM AUDIT] ${auditMessage}` });
        const retryText = "\n\n> *[System Audit: Enforcing Symbolic Integrity - Retrying]*\n\n";
        yield { text: retryText };
        if (contextSessionId) {
            eventBusService.emitKernelEvent(KernelEventType.INFERENCE_CHUNK, { 
                sessionId: contextSessionId, 
                text: retryText,
                correlationId: currentCorrelationId
            });
        }
        totalTextAccumulatedAcrossLoops = ""; // Reset failed narrative
        auditRetries++;
        continue;
    }

    // Persist this loop's assistant message
    if (contextSessionId && assistantMsg) {
        await contextService.recordMessage(contextSessionId, {
            id: randomUUID(),
            role: "assistant",
            content: stripThoughts(textAccumulatedInTurn),
            timestamp: new Date().toISOString(),
            toolCalls: turnToolCalls?.map(tc => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments })),
            correlationId: currentCorrelationId
        } as any);
    }

    if (isEndingTurn && !auditTriggered) break;

    transientMessages.length = 0; 

    if (turnToolCalls) {
        for (const call of turnToolCalls) {
          if (call.function.name === 'log_trace') hasLoggedTrace = true;
          const { data: args } = parseToolArguments(call.function.arguments);
          try {
              const result = await toolExecutor(call.function.name, args);
              if (contextSessionId) {
                  await contextService.recordMessage(contextSessionId, {
                      id: randomUUID(),
                      role: "tool",
                      content: JSON.stringify(result),
                      timestamp: new Date().toISOString(),
                      toolCallId: call.id,
                      toolName: call.function.name,
                      correlationId: currentCorrelationId
                  } as any);
              }
          } catch (error: any) {
              const errorMsg = `Error executing tool ${call.function.name}: ${error.message}`;
              if (contextSessionId) {
                await contextService.recordMessage(contextSessionId, {
                    id: randomUUID(),
                    role: "tool",
                    content: JSON.stringify({ error: errorMsg }),
                    timestamp: new Date().toISOString(),
                    toolCallId: call.id,
                    toolName: call.function.name,
                    correlationId: currentCorrelationId
                } as any);
              }
          }
        }
    }
    loops++;
  }

  // Periodic Summarization (Every 12 rounds for parity)
  if (contextSessionId) {
      const history = await contextService.getUnfilteredHistory(contextSessionId);
      const session = await contextService.getSession(contextSessionId);
      const userMessageIndices = history.map((m, i) => m.role === 'user' ? i : -1).filter(i => i !== -1);
      const lastSum = session?.metadata?.lastSummarizedRoundCount || 0;
      
      if (userMessageIndices.length >= lastSum + 12) {
          const startIndex = lastSum === 0 ? 0 : userMessageIndices[lastSum];
          const historySegment = history.slice(startIndex);
          const summary = await summarizeHistory(historySegment, session?.summary);
          await contextService.updateSession({
              ...session!,
              summary,
              metadata: { ...session?.metadata, lastSummarizedRoundCount: userMessageIndices.length }
          });
      }
  }

  yield { isComplete: true };
}

export const processMessageAsync = async (
    contextSessionId: string,
    message: string,
    toolExecutor: (name: string, args: any) => Promise<any>,
    systemInstruction: string,
    messageId?: string
) => {
    try {
        loggerService.catInfo(LogCategory.INFERENCE, "Starting async message processing", { contextSessionId, messageId });
        await contextService.setActiveMessage(contextSessionId, messageId || randomUUID());
        const { traceNeeded } = await primeSymbolicContext(message, contextSessionId);
        const session = await contextService.getSession(contextSessionId);
        if (session) {
            await contextService.updateSession({
                ...session,
                metadata: { ...session.metadata, trace_needed: traceNeeded }
            });
        }
        const chat = await getChatSession(systemInstruction, contextSessionId);
        const stream = sendMessageAndHandleTools(chat, message, toolExecutor, systemInstruction, contextSessionId);
        eventBusService.emitKernelEvent(KernelEventType.INFERENCE_STARTED, { sessionId: contextSessionId, messageId });
        for await (const chunk of stream) {
            if (chunk.isComplete) {
                eventBusService.emitKernelEvent(KernelEventType.INFERENCE_COMPLETED, { sessionId: contextSessionId, messageId });
            }
        }
    } catch (error: any) {
        loggerService.catError(LogCategory.INFERENCE, "Async Message Processing Failed", { contextSessionId, error: error.message });
        eventBusService.emitKernelEvent(KernelEventType.INFERENCE_ERROR, { sessionId: contextSessionId, messageId, error: error.message });
        await contextService.recordMessage(contextSessionId, {
            id: randomUUID(),
            role: "system",
            content: `Error processing message: ${error.message}`,
            timestamp: new Date().toISOString()
        } as any);
    } finally {
        await contextService.setActiveMessage(contextSessionId, null);
    }
};

export const extractJson = (text: string): any => {
    try { return JSON.parse(text); }
    catch (e) {
        const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (match) try { return JSON.parse(match[1].trim()); } catch (i) {}
        const f = text.indexOf('{'); const l = text.lastIndexOf('}');
        if (f !== -1 && l !== -1) try { return JSON.parse(text.substring(f, l + 1)); } catch (fi) {}
        throw e;
    }
};

export const summarizeHistory = async (history: ContextMessage[], currentSummary?: string): Promise<string> => {
    const settings = await settingsService.getInferenceSettings();
    const fastModel = settings.fastModel;
    if (!fastModel) return currentSummary || "";

    const cleanHistory = contextWindowService.stripTools(history);
    const historyText = cleanHistory.map(m => `${m.role.toUpperCase()}: ${stripThoughts(m.content || "").slice(0, 500)}`).join('\n');
    const prompt = `Summarize this conversation history into a concise, information-dense paragraph. ${currentSummary ? `Previous Summary: ${currentSummary}` : ''}\n\nHistory:\n${historyText}\n\nSUMMARY:`;

    try {
        if (settings.provider === 'gemini') {
            const client = await getGeminiClient();
            const model = client.getGenerativeModel({ model: fastModel });
            const result = await model.generateContent(prompt);
            return result.response.text().trim();
        }
        const client = await getClient();
        const response = await client.chat.completions.create({
            model: fastModel,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 800
        });
        return response.choices[0].message.content || currentSummary || "";
    } catch (e) {
        loggerService.catError(LogCategory.INFERENCE, "Summarization Error", { error: (e as any).message });
        return currentSummary || "";
    }
};

export const primeSymbolicContext = async (
    message: string,
    contextSessionId: string
): Promise<{ symbols: SymbolDef[], webResults: any[], traceNeeded: boolean }> => {
    const settings = await settingsService.getInferenceSettings();
    const fastModel = settings.fastModel;
    if (!fastModel) return { symbols: [], webResults: [], traceNeeded: true };

    const prompt = `Analyze: "${message}". SUGGEST symbolic queries and determine if log_trace is needed. Output JSON: { "queries": [], "trace_needed": boolean }`;

    try {
        const client = await getClient();
        const res = await client.chat.completions.create({
            model: fastModel,
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" }
        });
        const fastRes = extractJson(res.choices[0].message.content || "{}");
        
        const foundSymbols: SymbolDef[] = [];
        if (fastRes.queries?.length > 0) {
            for (const q of fastRes.queries) {
                const s = await domainService.search(q, 5);
                s.forEach(r => { if (!foundSymbols.find(fs => fs.id === r.id)) foundSymbols.push(r.metadata as SymbolDef); });
            }
            await symbolCacheService.batchUpsertSymbols(contextSessionId, foundSymbols);
        }

        return { symbols: foundSymbols, webResults: [], traceNeeded: !!fastRes.trace_needed };
    } catch (e) {
        loggerService.catError(LogCategory.INFERENCE, "Priming Error", { error: (e as any).message });
        return { symbols: [], webResults: [], traceNeeded: true };
    }
};

export const inferenceService = {
    getChatSession,
    sendMessageAndHandleTools,
    processMessageAsync,
    primeSymbolicContext,
    summarizeHistory,
    extractJson
};
