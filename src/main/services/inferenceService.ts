import OpenAI from "openai";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { randomUUID } from "crypto";
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { getPrimaryTools, SECONDARY_TOOLS_MAP } from "./toolsService.js";
import { SymbolDef, ContextMessage } from "../types.js";
import { domainService } from "./domainService.js";
import { settingsService } from "./settingsService.js";
import { loggerService, LogCategory } from './loggerService.js';
import { contextService } from './contextService.js';
import { symbolCacheService } from './symbolCacheService.js';
import { tentativeLinkService } from './tentativeLinkService.js';
import { contextWindowService } from './contextWindowService.js';
import { sqliteService } from './sqliteService.js';
import { lancedbService } from './lancedbService.js';
import { mcpClientService } from './mcpClientService.js';
import { eventBusService, KernelEventType } from './eventBusService.js';
import { webSearchService } from './webSearchService.js';

interface ChatSessionState {
  messages: ChatCompletionMessageParam[];
  systemInstruction: string;
  model: string;
}

const MAX_TOOL_LOOPS = 15;

export const getClient = async () => {
  const { endpoint, provider, apiKey } = await settingsService.getInferenceSettings();

  let effectiveEndpoint = endpoint;
  if (provider === 'openai') effectiveEndpoint = 'https://api.openai.com/v1';
  if (provider === 'kimi2') effectiveEndpoint = 'https://api.moonshot.ai/v1';

  loggerService.catInfo(LogCategory.INFERENCE, `getClient called`, {
    provider,
    effectiveEndpoint,
    originalEndpoint: endpoint,
    hasApiKey: !!apiKey
  });

  if (provider === 'openai') {
    return new OpenAI({
      baseURL: 'https://api.openai.com/v1',
      apiKey: apiKey,
    });
  }

  if (provider === 'kimi2') {
    return new OpenAI({
      baseURL: 'https://api.moonshot.ai/v1',
      apiKey: apiKey ? apiKey.trim() : apiKey,
    });
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

const extractTextDelta = (delta: ChatCompletionChunk["choices"][number]["delta"]) => {
  if (!delta?.content) return "";
  if (typeof delta.content === "string") return delta.content;
  if (Array.isArray(delta.content)) {
    return (delta.content as any[])
      .map((item: any) => {
        if (typeof item === "string") return item;
        if (item?.text) return item.text;
        return "";
      })
      .join("");
  }
  return "";
};

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
  try {
    return { data: JSON.parse(args) };
  } catch (error: any) {
    const message = error.message || String(error);
    loggerService.catWarn(LogCategory.INFERENCE, "Failed to parse tool arguments", { args, error: message });
    return {
      data: {},
      error: `JSON Parse Error: ${message}. Ensure you are providing a valid JSON object matching the tool's schema.`
    };
  }
};

const chatSessions = new Map<string, ChatSessionState>();

const createChatSession = async (systemInstruction: string): Promise<ChatSessionState> => ({
  messages: [{ role: "system", content: systemInstruction }],
  systemInstruction,
  model: await getModel(),
});

export const getChatSession = async (systemInstruction: string, contextSessionId?: string) => {
  const key = contextSessionId || "default";
  const existing = chatSessions.get(key);
  if (!existing || existing.systemInstruction !== systemInstruction) {
    const fresh = await createChatSession(systemInstruction);
    chatSessions.set(key, fresh);
  }
  const chat = chatSessions.get(key)!;
  const currentModel = await getModel();
  if (chat.model !== currentModel) chat.model = currentModel;
  return chat;
};

export const normalizeMessages = (messages: ChatCompletionMessageParam[]): ChatCompletionMessageParam[] => {
  if (messages.length === 0) return messages;
  const normalized: ChatCompletionMessageParam[] = [];
  let systemContent = "";
  const otherMessages = messages.filter(m => {
    if (m.role === 'system') {
      if (typeof m.content === 'string') {
        systemContent += (systemContent ? "\n\n" : "") + m.content;
      }
      return false;
    }
    return true;
  });
  if (systemContent) normalized.push({ role: 'system', content: systemContent });
  for (const msg of otherMessages) {
    const last = normalized[normalized.length - 1];
    if (last && last.role === msg.role && last.role !== 'tool' && !(last as any).tool_calls && !(msg as any).tool_calls) {
      if (typeof last.content === 'string' && typeof msg.content === 'string') {
        last.content += "\n\n" + msg.content;
        continue;
      }
    }
    normalized.push(msg);
  }
  return normalized;
};

export const streamAssistantResponse = async function* (
  messages: ChatCompletionMessageParam[],
  model: string,
  activeTools?: ChatCompletionTool[]
): AsyncGenerator<{
  text?: string;
  toolCalls?: ChatCompletionMessageToolCall[];
  assistantMessage?: ChatCompletionMessageParam;
}> {
  try {
    const normalized = normalizeMessages(messages);
    const tools = activeTools || await getPrimaryTools();
    for await (const chunk of _streamAssistantResponseInternal(normalized, model, tools)) {
      yield chunk;
    }
  } catch (error: any) {
    loggerService.catError(LogCategory.INFERENCE, "AI Provider Error (Stream)", {
      model,
      error: error.message || String(error)
    });
    throw error;
  }
};

const _streamAssistantResponseInternal = async function* (
  messages: ChatCompletionMessageParam[],
  model: string,
  activeTools: ChatCompletionTool[]
): AsyncGenerator<{
  text?: string;
  toolCalls?: ChatCompletionMessageToolCall[];
  assistantMessage?: ChatCompletionMessageParam;
}> {
  const settings = await settingsService.getInferenceSettings();

  if (settings.provider === 'gemini') {
    const client = await getGeminiClient();
    const geminiTools = toGeminiTools(activeTools);
    const geminiModel = client.getGenerativeModel({ model: model, tools: geminiTools });

    const systemMessage = messages.find(m => m.role === 'system');
    const history: any[] = [];
    let lastRole = '';

    for (const m of messages) {
      if (m.role === 'system') continue;
      if (m.role === 'user') {
        if (lastRole === 'user') {
          const lastMsg = history[history.length - 1];
          lastMsg.parts[0].text += `\n\n${typeof m.content === 'string' ? m.content : ''}`;
        } else {
          history.push({ role: 'user', parts: [{ text: typeof m.content === 'string' ? m.content : '' }] });
          lastRole = 'user';
        }
      } else if (m.role === 'assistant') {
        const parts: any[] = [];
        if (m.content) parts.push({ text: m.content });
        if (m.tool_calls) {
          m.tool_calls.forEach(tc => {
            parts.push({
              functionCall: {
                name: tc.function.name,
                args: JSON.parse(tc.function.arguments)
              }
            });
          });
        }
        if (lastRole === 'model') {
          const lastMsg = history[history.length - 1];
          lastMsg.parts.push(...parts);
        } else {
          history.push({ role: 'model', parts });
          lastRole = 'model';
        }
      } else if (m.role === 'tool') {
        let toolName = "unknown_tool";
        const assistantMsg = messages.find(msg =>
          msg.role === 'assistant' &&
          msg.tool_calls?.some(tc => tc.id === m.tool_call_id)
        );
        if (assistantMsg && assistantMsg.role === 'assistant' && assistantMsg.tool_calls) {
          const tc = assistantMsg.tool_calls.find(c => c.id === m.tool_call_id);
          if (tc) toolName = tc.function.name;
        }
        const part = { functionResponse: { name: toolName, response: { result: m.content } } };
        if (lastRole === 'function') {
          const lastMsg = history[history.length - 1];
          lastMsg.parts.push(part);
        } else {
          history.push({ role: 'function', parts: [part] });
          lastRole = 'function';
        }
      }
    }

    if (history.length === 0) history.push({ role: 'user', parts: [{ text: 'Hello' }] });
    let messageToSend = history.pop();
    if (messageToSend?.role === 'model') {
      history.push(messageToSend);
      messageToSend = { role: 'user', parts: [{ text: 'Continue' }] };
    }

    const chatSession = geminiModel.startChat({
      history: history,
      systemInstruction: systemMessage?.content ? { role: 'system', parts: [{ text: systemMessage.content as string }] } : undefined
    });

    const result = await chatSession.sendMessageStream(messageToSend.parts);
    let textAccumulator = "";
    const collectedToolCalls: ChatCompletionMessageToolCall[] = [];

    for await (const chunk of result.stream) {
      let text = "";
      try { text = chunk.text(); } catch (e) { }
      if (text) {
        textAccumulator += text;
        yield { text };
      }
      const calls = chunk.functionCalls();
      if (calls && calls.length > 0) {
        calls.forEach((call: any) => {
          const toolCallObj: any = {
            id: 'gemini-' + randomUUID(),
            type: 'function',
            function: {
              name: call.name,
              arguments: JSON.stringify(call.args)
            }
          };
          collectedToolCalls.push(toolCallObj);
        });
      }
    }

    if (collectedToolCalls.length > 0) yield { toolCalls: collectedToolCalls };
    const assistantMessage: ChatCompletionMessageParam = {
      role: "assistant",
      content: textAccumulator,
      ...(collectedToolCalls.length > 0 ? { tool_calls: collectedToolCalls } : {}),
    };
    yield { assistantMessage };
    return;
  }

  const client = await getClient();
  const stream = await client.chat.completions.create({
    model,
    messages,
    tools: activeTools,
    stream: true,
    max_tokens: 4096
  });

  let textAccumulator = "";
  const collectedToolCalls = new Map<number, ChatCompletionMessageToolCall>();

  for await (const part of stream) {
    const delta = part.choices?.[0]?.delta;
    if (!delta) continue;
    const textChunk = extractTextDelta(delta);
    if (textChunk) {
      textAccumulator += textChunk;
      yield { text: textChunk };
    }
    if (delta.tool_calls && delta.tool_calls.length > 0) {
      mergeToolCallDelta(collectedToolCalls, delta.tool_calls as any);
    }
  }

  const completedToolCalls = Array.from(collectedToolCalls.values());
  if (completedToolCalls.length > 0) yield { toolCalls: completedToolCalls };
  const assistantMessage: ChatCompletionMessageParam = {
    role: "assistant",
    content: textAccumulator,
    ...(completedToolCalls.length > 0 ? { tool_calls: completedToolCalls } : {}),
  };
  yield { assistantMessage };
};

export const resolveAttachments = async (message: string): Promise<{ resolvedContent: string; attachments: any[] }> => {
  const attachmentRegex = /<attachments>([\s\S]*?)<\/attachments>/;
  const match = message.match(attachmentRegex);
  if (!match) return { resolvedContent: message, attachments: [] };

  try {
    const jsonStr = match[1];
    const attachments = JSON.parse(jsonStr);
    if (!Array.isArray(attachments)) return { resolvedContent: message, attachments: [] };

    let resolvedContentStr = "\n\n--- Attachments ---\n";
    for (const att of attachments) {
      if (att.id) {
        const stored = await sqliteService.request(['GET', `attachment:${att.id}`]);
        if (stored) {
          try {
            const parsedDoc = JSON.parse(stored);
            resolvedContentStr += `\n[File: ${att.filename || 'unknown'} (${parsedDoc.type})]\n${parsedDoc.content}\n`;
            if (parsedDoc.structured_data?.analysis_model) {
              resolvedContentStr += `(Analysis by ${parsedDoc.structured_data.analysis_model})\n`;
            }
          } catch (e) {
            resolvedContentStr += `\n[Error reading attachment ${att.id}]\n`;
          }
        } else {
          resolvedContentStr += `\n[Attachment ${att.id} not found or expired]\n`;
        }
      }
    }
    return { resolvedContent: message.replace(match[0], resolvedContentStr), attachments };
  } catch (e) {
    loggerService.catWarn(LogCategory.INFERENCE, "Failed to parse attachment block", { error: e });
    return { resolvedContent: message, attachments: [] };
  }
};

export const stripThoughts = (text: string): string => {
  if (!text) return "";
  return text
    .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .replace(/<\/think>/gi, '')
    .replace(/<\/thought>/gi, '')
    .replace(/\[[\s\S]*?\]\(sz-think:thinking\)/g, '')
    .replace(/ +/g, ' ')
    .trim();
};

export async function* sendMessageAndHandleTools(
  chat: ChatSessionState,
  message: string,
  toolExecutor: (name: string, args: any) => Promise<any>,
  traceNeeded: boolean,
  systemInstruction?: string,
  contextSessionId?: string,
  userMessageId?: string,
  anticipatedWebResults?: any[],
  anticipatedWebBrief?: string,
  monitoringDeltas?: any[],

): AsyncGenerator<
  { text?: string; toolCalls?: any[]; isComplete?: boolean },
  void,
  unknown
> {
  const correlationId = userMessageId || randomUUID();
  const { resolvedContent, attachments } = await inferenceService.resolveAttachments(message);

  if (systemInstruction && chat.systemInstruction !== systemInstruction) {
    chat.messages = [{ role: "system", content: systemInstruction }];
    chat.systemInstruction = systemInstruction;
  }

  if (contextSessionId) {
    await contextService.recordMessage(contextSessionId, {
      id: correlationId,
      role: "user",
      content: resolvedContent,
      timestamp: new Date().toISOString(),
      metadata: {
        kind: "user_prompt",
        ...(attachments.length > 0 ? { attachments } : {})
      },
    } as any);
    await symbolCacheService.incrementTurns(contextSessionId);
    await tentativeLinkService.incrementTurns();
  }

  let loops = 0;
  let totalTextAccumulatedAcrossLoops = "";
  let previousTurnText = "";
  let hasLoggedTrace = false;

  let auditRetries = 0;
  const ENABLE_SYSTEM_AUDIT = true;
  const MAX_AUDIT_RETRIES = 3;
  const transientMessages: ChatCompletionMessageParam[] = [];
  let yieldedToolCalls: ChatCompletionMessageToolCall[] | undefined;

  const isNarrativeText = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith('[System') || trimmed.startsWith('> *[System')) return false;
    if (trimmed.includes('SYSTEM AUDIT FAILURE')) return false;
    const withoutThoughts = stripThoughts(trimmed);
    if (!withoutThoughts) return false;
    if (withoutThoughts.startsWith('[Tool') || withoutThoughts.startsWith('{"status":')) return false;
    return withoutThoughts.length > 2;
  };

  while (loops < MAX_TOOL_LOOPS && auditRetries < MAX_AUDIT_RETRIES + 1) {
    loggerService.catDebug(LogCategory.INFERENCE, `Starting turn loop ${loops}/${MAX_TOOL_LOOPS}`, {
      contextSessionId,
      previousTurnTextLength: previousTurnText.length,
      totalTextAccumulatedAcrossLoopsLength: totalTextAccumulatedAcrossLoops.length,
      traceNeeded
    });
    yieldedToolCalls = undefined;
    if (contextSessionId) {
      const session = await contextService.getSession(contextSessionId);
      if (!session || session.status === 'closed') {
        loggerService.catInfo(LogCategory.INFERENCE, "Context closed during inference, aborting.", { contextSessionId });
        yield { text: "\n[System] Context archived. Inference aborted." };
        break;
      }

      const settings = await settingsService.getInferenceSettings();
      if (settings.provider === 'gemini') {
        const history = await contextService.getUnfilteredHistory(contextSessionId);
        if (history.length >= 2) {
          const lastMsg = history[history.length - 1];
          const penultMsg = history[history.length - 2];
          const hasNarrative = isNarrativeText(penultMsg.content || "");
          const hasTrace = penultMsg.toolCalls?.some(tc => tc.name === 'log_trace');
          const lastIsTool = lastMsg.role === 'tool';
          if (penultMsg.role === 'assistant' && hasNarrative && hasTrace && lastIsTool) {
            loggerService.catInfo(LogCategory.INFERENCE, "Gemini Termination: Detected narrative + trace followed by tool result.", { contextSessionId, loops });
            break;
          }
        }
      }
    }

    const MAX_RETRIES = 3;
    let retries = 0;
    let nextAssistant: ChatCompletionMessageParam | null = null;
    let textAccumulatedInTurn = "";

    while (retries < MAX_RETRIES) {
      let contextMessages: ChatCompletionMessageParam[] = [];
      if (contextSessionId) {
        const result = await contextWindowService.constructContextWindow(contextSessionId, systemInstruction || chat.systemInstruction);
        contextMessages = result.messages;
        eventBusService.emitKernelEvent(KernelEventType.INFERENCE_TOKENS, { sessionId: contextSessionId, totalTokens: result.totalTokens });
      } else {
        contextMessages = [{ role: 'system', content: systemInstruction || chat.systemInstruction }, { role: 'user', content: resolvedContent }] as ChatCompletionMessageParam[];
      }

      if (transientMessages.length > 0) contextMessages = [...contextMessages, ...transientMessages];

      if (loops === 0) {
        if (anticipatedWebBrief) {
          contextMessages.push({ role: 'system', content: `\n\n[ANTICIPATED WEB SEARCH BRIEF]\n${anticipatedWebBrief}` });
        } else if (anticipatedWebResults && anticipatedWebResults.length > 0) {
          contextMessages.push({ role: 'system', content: `\n\n[ANTICIPATED WEB SEARCH RESULTS]\n${JSON.stringify(anticipatedWebResults, null, 2)}` });
        }

        if (monitoringDeltas && monitoringDeltas.length > 0) {
          const deltaBrief = monitoringDeltas.map(d => `Source: ${d.metadata.sourceId} (${d.metadata.period})\nTimestamp: ${d.metadata.timestamp}\nContent: ${d.document}`).join('\n\n---\n\n');
          contextMessages.push({ role: 'system', content: `\n\n[WORLD MONITORING DELTAS]\nThe following recent changes and events have been detected in the world:\n\n${deltaBrief}` });
        }
      }

      let activeToolList = [...await getPrimaryTools()];
      if (contextSessionId) {
        try {
          const currentSession = await contextService.getSession(contextSessionId);
          const requestedTools = currentSession?.metadata?.active_tools || [];
          const secondaryTools = requestedTools.map((name: string) => SECONDARY_TOOLS_MAP[name]).filter(Boolean);

          // MCP Tools are dynamically fetched and included if enabled in settings
          const remoteTools = await mcpClientService.getAllTools();

          activeToolList = [...await getPrimaryTools(), ...secondaryTools, ...remoteTools];
        } catch (e) {
          loggerService.catWarn(LogCategory.INFERENCE, "Failed to fetch active tools", { error: e });
        }
      }

      const assistantMessage = inferenceService.streamAssistantResponse(contextMessages as ChatCompletionMessageParam[], chat.model, activeToolList);
      textAccumulatedInTurn = "";
      let rawTextInTurn = "";
      yieldedToolCalls = undefined;
      nextAssistant = null;

      for await (const chunk of assistantMessage) {
        if (chunk.text) {
          rawTextInTurn += chunk.text;
        }
        if (chunk.toolCalls) {
          yieldedToolCalls = chunk.toolCalls;
          yield { toolCalls: chunk.toolCalls };
        }
        if (chunk.assistantMessage) nextAssistant = chunk.assistantMessage;
      }

      textAccumulatedInTurn = stripThoughts(rawTextInTurn);

      if (textAccumulatedInTurn.trim() || (yieldedToolCalls && yieldedToolCalls.length > 0)) break;
      retries++;
      loggerService.catWarn(LogCategory.INFERENCE, `Empty model response. Retry ${retries}/${MAX_RETRIES}...`, { contextSessionId });
    }

    if (!nextAssistant) {
      yield { text: "Error: No assistant message returned." };
      break;
    }

    if ((nextAssistant as any).tool_calls) {
      for (const call of (nextAssistant as any).tool_calls) {
        const { error: parseError } = parseToolArguments(call.function.arguments || "");
        if (parseError) {
          loggerService.catWarn(LogCategory.INFERENCE, "Detected malformed JSON in tool call.", { callId: call.id, toolName: call.function.name });
          call.function.arguments = "{}";
        }
      }
    }

    // --- Tool Execution ---
    const toolResponses: ChatCompletionMessageParam[] = [];
    if (yieldedToolCalls && yieldedToolCalls.length > 0) {
      for (const call of yieldedToolCalls) {
        if (!call.function?.name) continue;
        let toolName = call.function.name;
        if (toolName === 'log_trace') hasLoggedTrace = true;
        const { data: args, error: parseError } = parseToolArguments(call.function.arguments || "");

        if (parseError) {
          const errorPayload = { status: "error", error: "Malformed JSON", details: parseError };
          toolResponses.push({ role: "tool", content: JSON.stringify(errorPayload), tool_call_id: call.id });
          if (contextSessionId) {
            await contextService.recordMessage(contextSessionId, {
              id: randomUUID(), role: "tool", content: JSON.stringify(errorPayload),
              timestamp: new Date().toISOString(), toolName, toolCallId: call.id,
              metadata: { kind: "tool_error" }, correlationId: correlationId
            } as any);
          }
          continue;
        }

        try {
          const result = await toolExecutor(toolName, args);
          toolResponses.push({ role: "tool", content: JSON.stringify(result), tool_call_id: call.id });
          if (contextSessionId) {
            await contextService.recordMessage(contextSessionId, {
              id: randomUUID(), role: "tool", content: JSON.stringify(result),
              timestamp: new Date().toISOString(), toolName, toolCallId: call.id,
              metadata: { kind: "tool_result" }, correlationId: correlationId
            } as any);
          }
        } catch (err) {
          loggerService.catError(LogCategory.INFERENCE, `Error executing tool ${toolName}`, { err });
          toolResponses.push({ role: "tool", content: JSON.stringify({ error: String(err) }), tool_call_id: call.id });
          if (contextSessionId) {
            await contextService.recordMessage(contextSessionId, {
              id: randomUUID(), role: "tool", content: JSON.stringify({ error: String(err) }),
              timestamp: new Date().toISOString(), toolName, toolCallId: call.id,
              metadata: { kind: "tool_error" }, correlationId: correlationId
            } as any);
          }
        }
      }
    }

    let auditTriggered = false;
    let auditMessage = "";
    const currentToolNames = new Set((yieldedToolCalls || []).map(tc => tc.function?.name || ""));
    const isCallingTraceThisTurn = currentToolNames.has('log_trace');
    const traceSatisfied = !traceNeeded || (hasLoggedTrace || isCallingTraceThisTurn);
    const assistantDoesNotNeedToolResponse = !currentToolNames.has('find_symbols') && !currentToolNames.has('load_symbols') && !currentToolNames.has('web_search');
    const hasNarrativeOutput = isNarrativeText(textAccumulatedInTurn);
    const isEndingTurn = (!yieldedToolCalls || yieldedToolCalls.length === 0) || (assistantDoesNotNeedToolResponse && hasNarrativeOutput);
    loggerService.catDebug(LogCategory.INFERENCE, "Turn end check", { traceSatisfied, assistantDoesNotNeedToolResponse, hasNarrativeOutput, isEndingTurn });

    if (isEndingTurn && ENABLE_SYSTEM_AUDIT && auditRetries < MAX_AUDIT_RETRIES) {
      if (!traceSatisfied) {
        auditMessage += "⚠️ SYSTEM AUDIT FAILURE: YOU MUST TRACE THIS OPERATION! This operation was flagged for complex analytic tracing, but you failed to call `log_trace`. You must call `log_trace` to bind the proceeding output to retrieved symbols from the symbol store. This trace must be comprehensive. Do not acknowledge this message or repeat previous information.\n";
        auditTriggered = true;
      }
    }

    if (auditTriggered) {
      if (auditRetries < MAX_AUDIT_RETRIES) {
        loggerService.catWarn(LogCategory.INFERENCE, "System Audit Failure: Missing required check.", { contextSessionId, auditRetries, hasLoggedTrace });

        const finalAuditMessage = auditMessage + "Retry immediately to satisfy the audit message. Do not acknowledge this message.";

        transientMessages.push(nextAssistant!);
        if (toolResponses.length > 0) transientMessages.push(...toolResponses);
        transientMessages.push({ role: "user", content: `[SYSTEM AUDIT] ${finalAuditMessage}` });
        auditRetries++;
        continue;
      } else {
        loggerService.catError(LogCategory.INFERENCE, "System Audit: Max retries reached. Proceeding despite violations.", { contextSessionId });
        auditTriggered = false;
      }
    }

    // --- SUCCESSFUL TURN ACCUMULATION ---
    // Only accumulate narrative if the turn passed audit
    if (totalTextAccumulatedAcrossLoops.length > 0 && textAccumulatedInTurn.trim().length > 0) {
      totalTextAccumulatedAcrossLoops += "\n\n" + textAccumulatedInTurn;
    } else {
      totalTextAccumulatedAcrossLoops += textAccumulatedInTurn;
    }

    // YIELD NARRATIVE ONLY ON FINAL TURN
    if (isEndingTurn && totalTextAccumulatedAcrossLoops.trim().length > 0) {
      yield { text: totalTextAccumulatedAcrossLoops.trim() };
    }

    // Update transient messages for the next loop
    transientMessages.push(nextAssistant!);
    if (toolResponses.length > 0) {
      transientMessages.push(...toolResponses);
    }

    if (isEndingTurn) {
      // Record final assistant message to database
      if (contextSessionId) {
        await contextService.recordMessage(contextSessionId, {
          id: randomUUID(),
          role: "assistant",
          content: stripThoughts(totalTextAccumulatedAcrossLoops),
          timestamp: new Date().toISOString(),
          toolCalls: (nextAssistant as any).tool_calls?.map((call: any) => ({
            id: call.id,
            name: call.function?.name,
            arguments: call.function?.arguments
          })),
          metadata: { kind: "assistant_response" },
          correlationId: correlationId
        } as any);

        // --- Context Auto-Naming Logic ---
        try {
          const session = await contextService.getSession(contextSessionId);
          if (session && (!session.name || session.name.startsWith('Context '))) {
            const history = await contextService.getUnfilteredHistory(contextSessionId);
            if (history.length >= 2 && history.length <= 4) {
              const settings = await settingsService.getInferenceSettings();
              const fastModel = settings.fastModel;
              if (fastModel) {
                const historyText = history
                  .filter(m => m.role !== 'system')
                  .map(m => `${m.role.toUpperCase()}: ${stripThoughts(m.content || "").slice(0, 200)}`)
                  .join('\n');
                const namingPrompt = `Based on the following start of a conversation, generate a very concise (2-4 words) natural language title for this chat. Output ONLY the title text.\n\n${historyText}\n\nTITLE:`;
                let newName = "";
                if (settings.provider === 'gemini') {
                  const client = await getGeminiClient();
                  const model = client.getGenerativeModel({ model: fastModel });
                  const result = await model.generateContent(namingPrompt);
                  newName = result.response.text().trim();
                } else {
                  const client = await getClient();
                  const result = await client.chat.completions.create({ model: fastModel, messages: [{ role: "user", content: namingPrompt }], max_tokens: 20 });
                  newName = result.choices[0]?.message?.content?.trim() || "";
                }
                if (newName) {
                  newName = newName.replace(/^["']|["']$/g, '').slice(0, 50);
                  await contextService.updateSession({ ...session, name: newName });
                  eventBusService.emitKernelEvent(KernelEventType.CONTEXT_UPDATED, { sessionId: contextSessionId, name: newName });
                }
              }
            }
          }
        } catch (namingError) { }
      }
      break;
    }

    if (auditRetries >= MAX_AUDIT_RETRIES) {
      break;
    }

    // Setup for next loop
    yieldedToolCalls = undefined;
    loops++;
  }

  // Summarization compression
  if (contextSessionId) {
    try {
      const session = await contextService.getSession(contextSessionId);
      const history = await contextService.getUnfilteredHistory(contextSessionId);
      const userMessageIndices = history.map((m, i) => m.role === 'user' ? i : -1).filter(i => i !== -1);
      const totalRounds = userMessageIndices.length;
      const lastSummarizedCount = session?.metadata?.lastSummarizedRoundCount || 0;
      if (session && totalRounds >= lastSummarizedCount + 12) {
        const roundsToSummarizeCount = 12;
        const startIndex = lastSummarizedCount === 0 ? 0 : userMessageIndices[lastSummarizedCount];
        const endIndex = userMessageIndices[lastSummarizedCount + roundsToSummarizeCount] || history.length;
        const historySegment = history.slice(startIndex, endIndex);
        const newSummary = await summarizeHistory(historySegment, session.summary);
        if (newSummary !== session.summary) {
          session.summary = newSummary;
          session.metadata = { ...(session.metadata || {}), lastSummarizedRoundCount: lastSummarizedCount + roundsToSummarizeCount };
          await contextService.updateSession(session);
        }
      }
    } catch (err) { }
  }

  yield { isComplete: true };
}

export const extractJson = (text: string): any => {
  const tryParse = (str: string) => {
    try {
      return JSON.parse(str);
    } catch (e) {
      // Heuristic: common error is unescaped double quotes inside strings.
      // This is a very basic attempt to fix them for common cases like "He said "Hello""
      // We look for patterns like: "key": "value "with" quotes"
      let fixed = str
        .replace(/":\s*"(.*?)"(\s*[,}\n])/g, (_match, p1, p2) => {
          // If p1 contains unescaped quotes, escape them
          const escaped = p1.replace(/(?<!\\)"/g, '\\"');
          return `": "${escaped}"${p2}`;
        });
      try {
        return JSON.parse(fixed);
      } catch (inner) {
        return null;
      }
    }
  };

  const direct = tryParse(text);
  if (direct) return direct;

  loggerService.catDebug(LogCategory.INFERENCE, "Direct JSON.parse failed, attempting extraction...", { text: text.slice(0, 100) });

  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    const extracted = tryParse(match[1].trim());
    if (extracted) return extracted;
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    const extracted = tryParse(text.substring(firstBrace, lastBrace + 1));
    if (extracted) return extracted;
  }

  loggerService.catError(LogCategory.INFERENCE, "All JSON extraction attempts failed", { text });
  throw new Error("JSON extraction failed");
};

export const summarizeHistory = async (history: ContextMessage[], currentSummary?: string): Promise<string> => {
  const settings = await settingsService.getInferenceSettings();
  const fastModel = settings.fastModel;
  if (!fastModel) return currentSummary || "";
  const cleanHistory = contextWindowService.stripTools(history);
  const historyText = cleanHistory.map(m => `${m.role.toUpperCase()}: ${stripThoughts(m.content || "")}`).join('\n');
  const prompt = `Summarize the following conversation concisely: ${currentSummary ? `Previous: ${currentSummary}\n` : ''} History: ${historyText} SUMMARY:`;
  try {
    if (settings.provider === 'gemini') {
      const client = await getGeminiClient();
      const model = client.getGenerativeModel({ model: fastModel });
      const result = await model.generateContent(prompt);
      return result.response.text().trim();
    }
    const client = await getClient();
    const result = await client.chat.completions.create({ model: fastModel, messages: [{ role: "user", content: prompt }], max_tokens: 800 });
    return result.choices[0]?.message?.content?.trim() ?? (currentSummary || "");
  } catch (error) { return currentSummary || ""; }
};

export const synthesizeWebResults = async (
  queryResults: { query: string, results: { title: string, snippet: string, url: string }[] }[]
): Promise<string> => {
  const settings = await settingsService.getInferenceSettings();
  const fastModel = settings.fastModel;
  if (!fastModel || queryResults.length === 0) return "";
  let resultsText = "";
  queryResults.forEach(qr => {
    resultsText += `\n[RESULTS FOR QUERY: "${qr.query}"]\n`;
    qr.results.forEach((r, i) => {
      resultsText += `${i + 1}. ${r.title}\n   Snippet: ${r.snippet}\n   URL: ${r.url}\n`;
    });
  });
  const prompt = `Synthesize these research results into a dense Knowledge Brief: ${resultsText}`;
  try {
    if (settings.provider === 'gemini') {
      const client = await getGeminiClient();
      const model = client.getGenerativeModel({ model: fastModel });
      const result = await model.generateContent(prompt);
      return result.response.text().trim();
    }
    const client = await getClient();
    const result = await client.chat.completions.create({ model: fastModel, messages: [{ role: "user", content: prompt }], max_tokens: 800 });
    return result.choices[0]?.message?.content?.trim() ?? "";
  } catch (error) { return ""; }
};

export const primeSymbolicContext = async (
  message: string,
  contextSessionId: string
): Promise<{
  symbols: SymbolDef[],
  webResults: any[],
  webBrief?: string,
  monitoringDeltas?: any[],
  traceNeeded: boolean,
  traceReason?: string
}> => {
  const foundSymbols: SymbolDef[] = [];
  const webResults: any[] = [];
  const monitoringDeltas: any[] = [];
  let traceNeeded = true;
  let traceReason: string | undefined;
  let webBrief: string | undefined;

  try {
    const settings = await settingsService.getInferenceSettings();
    const fastModel = settings.fastModel;
    if (!fastModel) {
      loggerService.catWarn(LogCategory.INFERENCE, "No fastModel configured, skipping symbolic priming.");
      return { symbols: [], webResults: [], traceNeeded };
    }

    const session = await contextService.getSession(contextSessionId);
    const history = await contextService.getUnfilteredHistory(contextSessionId);
    const recentHistory = history.slice(-10);
    const historyContext = recentHistory.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');

    // Identify previous web searches to avoid duplicates
    const previousSearches = history
      .flatMap(m => {
        const searches: string[] = [];
        // Handle tool calls in history
        if (m.toolName === 'web_search' && (m as any).toolArgs?.query) searches.push((m as any).toolArgs.query);
        // Handle recorded metadata
        if (m.metadata?.kind === 'anticipated_web_search' && Array.isArray(m.metadata?.queries)) {
          m.metadata.queries.forEach((q: string) => searches.push(q));
        }
        return searches;
      })
      .filter((q, i, self) => q && self.indexOf(q) === i);

    const currentName = session?.name;
    const userMessageCount = history.filter(m => m.role === 'user').length + 1;
    const needsNaming = !currentName || currentName.startsWith('Context ') || (userMessageCount % 10 === 0);

    loggerService.catInfo(LogCategory.INFERENCE, `Priming symbolic context with fastModel: ${fastModel}`, {
      contextSessionId,
      historyCount: recentHistory.length,
      needsNaming
    });

    const prompt = `Analyze the conversation history and the new user message to identify 3 symbolic search queries and determine if web search grounding is needed. 
    
    Additionally, generate 2 "orthogonal_queries" that explore the local opposite of your predictions, including antonyms, contradictory logic, or orthogonal concepts to ensure context diversity.
    
    ${needsNaming ? 'CRITICAL: Based on the conversation context, suggest a descriptive and concise name for this context session in "suggested_name".' : ''}

    CRITICAL: Only set "web_search_needed" to true if the message involves an external entity (person, company, place), a complex technical/scientific topic, or a current event that requires grounding in facts.

    Conversation History:
    ${historyContext || "No previous history."}

    New User Message: "${message}"

    Previous Web Searches (DO NOT REPEAT THESE):
    ${previousSearches.length > 0 ? previousSearches.join(', ') : "None."}

    Output valid JSON only:
    {
      "queries": ["symbolic query1", "symbolic query2", ...],
      "orthogonal_queries": ["opposite query1", "orthogonal query2", ...],
      "web_search_needed": boolean,
      "web_search_queries": ["search query1", "search query2", ...],
      "trace_needed": boolean,
      "trace_reason": "Brief explanation if trace_needed is true",
      "suggested_name": string | null
    }`;

    let fastResponse: any = {};
    if (settings.provider === 'gemini') {
      const client = await getGeminiClient();
      const model = client.getGenerativeModel({ 
        model: fastModel, 
        generationConfig: { 
          maxOutputTokens: 1024
        } 
      });
      const result = await model.generateContent(prompt);
      fastResponse = extractJson(result.response.text());
    } else {
      const client = await getClient();
      const result = await client.chat.completions.create({ 
        model: fastModel, 
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1024
      });
      fastResponse = extractJson(result.choices[0]?.message?.content || "{}");
    }

    loggerService.catInfo(LogCategory.INFERENCE, "Fast model priming response received", { fastResponse });

    const symbolicQueriesRaw = fastResponse.queries || [];
    const orthogonalQueriesRaw = fastResponse.orthogonal_queries || [];
    const webSearchQueriesRaw = fastResponse.web_search_queries || [];

    // Normalize queries to strings (handling models that return objects with "query" property)
    const normalize = (q: any) => typeof q === 'string' ? q : (q.query || JSON.stringify(q));

    const symbolicQueries = [...symbolicQueriesRaw.map(normalize), ...orthogonalQueriesRaw.map(normalize)];
    const webSearchQueries = webSearchQueriesRaw.map(normalize);

    traceNeeded = !!fastResponse.trace_needed;
    traceReason = fastResponse.trace_reason;

    // Handle session naming if suggested
    if (fastResponse.suggested_name && fastResponse.suggested_name !== currentName) {
      loggerService.catInfo(LogCategory.INFERENCE, `Fast model suggested session name: ${fastResponse.suggested_name}`);
      const cleanName = fastResponse.suggested_name.replace(/^["']|["']$/g, '').slice(0, 50);
      await contextService.renameSession(contextSessionId, cleanName);
      eventBusService.emitKernelEvent(KernelEventType.CONTEXT_UPDATED, { sessionId: contextSessionId, name: cleanName });
    }

    if (symbolicQueries.length > 0) {
      loggerService.catInfo(LogCategory.INFERENCE, `Executing ${symbolicQueries.length} symbolic search queries.`, { symbolicQueries });
      for (const query of symbolicQueries) {
        const res = await domainService.search(query, 5);
        loggerService.catDebug(LogCategory.INFERENCE, `Search results for "${query}": ${res.length} symbols found.`);
        res.forEach((r: any) => { if (!foundSymbols.find(s => s.id === r.id)) foundSymbols.push(r.metadata as SymbolDef); });
      }
      if (foundSymbols.length > 0) {
        loggerService.catInfo(LogCategory.INFERENCE, `Symbolic Store returned ${foundSymbols.length} unique symbols for precache.`);
        const { added, updated } = await symbolCacheService.batchUpsertSymbols(contextSessionId, foundSymbols);
        loggerService.catInfo(LogCategory.INFERENCE, `Primed cache: ${added} new, ${updated} filtered/updated.`);
        await symbolCacheService.emitCacheLoad(contextSessionId);
      }
    }

    if (fastResponse.web_search_needed && webSearchQueries.length > 0) {
      for (const q of webSearchQueries) {
        try {
          const { results, provider } = await webSearchService.search(q);
          if (results.length > 0) {
            webResults.push({ query: q, results: results.slice(0, 5), provider });
          }
        } catch (e) {
          loggerService.catError(LogCategory.INFERENCE, "Anticipated web search failed", { query: q, error: e });
        }
      }
      if (webResults.length > 0) {
        webBrief = await synthesizeWebResults(webResults);
        await contextService.recordMessage(contextSessionId, {
          id: randomUUID(), role: "system", content: `[System] Executed ${webResults.length} anticipated web searches for grounding.`,
          timestamp: new Date().toISOString(), metadata: { kind: "anticipated_web_search", queries: webSearchQueries, resultsCount: webResults.length }
        } as any);
      }
    }

    // --- Automated Monitoring Delta Precache ---
    try {
      const monSettings = await settingsService.getMonitoringSettings();
      if (monSettings.enabled) {
        const deltaResults = await lancedbService.searchDeltas(message, 5);
        if (deltaResults.length > 0) {
          loggerService.catInfo(LogCategory.INFERENCE, `Precached ${deltaResults.length} monitoring deltas for grounding.`, {
            sources: deltaResults.map(d => d.metadata.sourceId)
          });
          monitoringDeltas.push(...deltaResults);
        }
      }
    } catch (e) {
      loggerService.catError(LogCategory.INFERENCE, "Delta precache failed", { error: e });
    }
  } catch (e) { loggerService.catError(LogCategory.INFERENCE, "Priming failed", { error: e }); }
  return { symbols: foundSymbols, webResults, webBrief, monitoringDeltas, traceNeeded, traceReason };
};

export const processMessageAsync = async (
  contextSessionId: string,
  message: string,
  toolExecutor: (name: string, args: any) => Promise<any>,
  systemInstruction: string,
  messageId?: string
) => {
  let messageTraceNeeded = false;
  try {
    const { webResults, webBrief, monitoringDeltas, traceNeeded, traceReason } = await primeSymbolicContext(message, contextSessionId);
    const session = await contextService.getSession(contextSessionId);
    if (session) {
      if (traceNeeded === undefined) {
        messageTraceNeeded = true;
      }
      await contextService.updateSession({
        ...session,
        metadata: {
          ...session.metadata,
          trace_needed: traceNeeded,
          trace_reason: traceReason
        }
      });
    }
    const chat = await getChatSession(systemInstruction, contextSessionId);
    const stream = sendMessageAndHandleTools(chat, message, toolExecutor, messageTraceNeeded, systemInstruction, contextSessionId, messageId, webResults, webBrief, monitoringDeltas);
    eventBusService.emitKernelEvent(KernelEventType.INFERENCE_STARTED, { sessionId: contextSessionId, messageId });
    for await (const chunk of stream) {
      if (chunk.isComplete) eventBusService.emitKernelEvent(KernelEventType.INFERENCE_COMPLETED, { sessionId: contextSessionId, messageId });
    }
  } catch (error: any) {
    loggerService.catError(LogCategory.INFERENCE, "Async Message Processing Failed", { contextSessionId, error: error.message });
    eventBusService.emitKernelEvent(KernelEventType.INFERENCE_ERROR, { sessionId: contextSessionId, messageId, error: error.message });
  }
};

export const inferenceService = {
  getChatSession,
  sendMessageAndHandleTools,
  processMessageAsync,
  primeSymbolicContext,
  summarizeHistory,
  extractJson,
  streamAssistantResponse,
  resolveAttachments
};
