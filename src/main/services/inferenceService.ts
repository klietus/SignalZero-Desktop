import OpenAI from "openai";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { randomUUID } from "crypto";
import type {
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
import { attachmentService, Attachment } from './attachmentService.js';
import { mcpClientService } from './mcpClientService.js';
import { eventBusService } from './eventBusService.js';
import { KernelEventType } from '../types.js';
import { webSearchService } from './webSearchService.js';
import { workerService } from './workerService.js';
import { realtimeService } from './realtime/realtimeService.js';
import { llamaService, urgentLlamaService, LlamaPriority } from './llamaService.js';

interface ChatSessionState {
  messages: ChatCompletionMessageParam[];
  systemInstruction: string;
  model: string;
}

const MAX_TOOL_LOOPS = 15;

/**
 * Global Inference Lock to prevent GPU starvation on local hardware.
 * Ensures only one heavy model turn runs at a time, with priority for User Chat.
 */
class InferenceLockManager {
  private isLocked = false;
  private runningProvider: string | null = null;
  private queue: { priority: number, model: string, provider: string, resolve: () => void }[] = [];

  async acquire(priority: number = 0, model: string, provider: string): Promise<void> {
    // LOCK LOGIC:
    // We only lock if:
    // 1. The provider is 'local' (Hardware Bound)
    // 2. AND something is already running on that local provider.
    // If it's Gemini or OpenAI, we don't care about the lock (Cloud Scaled).

    const isConflict = this.isLocked &&
      this.runningProvider === 'local' &&
      provider === 'local';

    if (!isConflict) {
      this.isLocked = true;
      this.runningProvider = provider;
      return;
    }

    // It's a local hardware conflict, must queue.
    return new Promise((resolve) => {
      if (priority > 0) {
        const lastHighPriorityIdx = this.queue.findLastIndex(item => item.priority > 0);
        this.queue.splice(lastHighPriorityIdx + 1, 0, { priority, model, provider, resolve });
      } else {
        this.queue.push({ priority, model, provider, resolve });
      }
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        this.runningProvider = next.provider;
        next.resolve();
        return;
      }
    }
    this.isLocked = false;
    this.runningProvider = null;
  }
}

export const inferenceLock = new InferenceLockManager();

let _isCancelled = false;

export const callFastInference = async (
  messages: { role: string, content: string }[],
  maxTokens: number = 4096,
  _attachments?: any[],
  priority: LlamaPriority = LlamaPriority.LOW
): Promise<string> => {
  const startTime = performance.now();
  const requestId = randomUUID();

  eventBusService.emitKernelEvent(KernelEventType.FAST_INFERENCE_STARTED, { requestId, timestamp: new Date().toISOString() } as const);

  try {
    // Inject "No Thinking" constraint into the first system message if it exists, otherwise add one.
    const augmentedMessages = [...messages];
    const systemIdx = augmentedMessages.findIndex(m => m.role === 'system');
    const noThinkingDirective = "CRITICAL: Output ONLY the final result. Do NOT include any reasoning, thinking, or <think> blocks.";

    if (systemIdx !== -1) {
      augmentedMessages[systemIdx].content = `${noThinkingDirective}\n\n${augmentedMessages[systemIdx].content}`;
    } else {
      augmentedMessages.unshift({ role: 'system', content: noThinkingDirective });
    }

    // Qwen/ChatML template
    let prompt = "";
    for (const m of augmentedMessages) {
      prompt += `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`;
    }
    prompt += `<|im_start|>assistant\n`;

    // Route to appropriate sidecar based on priority
    const service = (priority >= LlamaPriority.HIGH) ? urgentLlamaService : llamaService;

    const result = await service.completion(prompt, {
      maxTokens,
      priority,
      stop: ["<|im_end|>", "<|im_start|>", "assistant:", "user:", "system:"]
    });

    const duration = performance.now() - startTime;
    // Strip thoughts if the model ignored the directive
    const rawResponse = result.content || "";
    const responseText = stripThoughts(rawResponse).trim();

    eventBusService.emitKernelEvent(KernelEventType.FAST_INFERENCE_COMPLETED, {
      requestId,
      durationMs: duration,
      tokenCount: responseText.length / 4,
      status: 'success',
      timestamp: new Date().toISOString()
    } as const);

    loggerService.catDebug(LogCategory.INFERENCE, "Fast inference metrics", { durationMs: duration, requestId });

    return responseText;
  } catch (error: any) {
    const duration = performance.now() - startTime;
    eventBusService.emitKernelEvent(KernelEventType.FAST_INFERENCE_COMPLETED, {
      requestId,
      durationMs: duration,
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    } as const);

    loggerService.catError(LogCategory.INFERENCE, "Fast inference (llama sidecar) failed", { error: error.message, durationMs: duration });
    throw error;
  }
};

export const getClient = async () => {
  const { endpoint, provider, apiKey } = await settingsService.getInferenceSettings();

  let effectiveEndpoint = endpoint;
  if (provider === 'openai') effectiveEndpoint = 'https://api.openai.com/v1';
  if (provider === 'kimi2') effectiveEndpoint = 'https://api.moonshot.ai/v1';

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
    baseURL: effectiveEndpoint,
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

  const cleaned: any = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'additionalProperties') continue;
    if (key === 'oneOf' || key === 'anyOf' || key === 'allOf') {
      cleaned[key] = (value as any[]).map(cleanGeminiSchema);
    } else if (typeof value === 'object') {
      cleaned[key] = cleanGeminiSchema(value);
    } else {
      cleaned[key] = value;
    }
  }
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

const extractTextDelta = (delta: any) => {
  let text = "";
  if (delta?.content) {
    if (typeof delta.content === "string") {
      text += delta.content;
    } else if (Array.isArray(delta.content)) {
      text += (delta.content as any[])
        .map((item: any) => {
          if (typeof item === "string") return item;
          if (item?.text) return item.text;
          return "";
        })
        .join("");
    }
  }
  // Support for providers that send reasoning in separate fields (e.g. DeepSeek, Groq, OpenRouter)
  if (delta?.reasoning_content) text += delta.reasoning_content;
  if (delta?.thought_content) text += delta.thought_content;
  return text;
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

const createChatSession = async (systemInstruction: string, modelOverride?: string): Promise<ChatSessionState> => ({
  messages: [{ role: "system", content: systemInstruction }],
  systemInstruction,
  model: modelOverride || await getModel(),
});

export const getChatSession = async (systemInstruction: string, contextSessionId?: string, modelOverride?: string) => {
  const key = contextSessionId || "default";
  const existing = chatSessions.get(key);
  if (!existing || existing.systemInstruction !== systemInstruction) {
    const fresh = await createChatSession(systemInstruction, modelOverride);
    chatSessions.set(key, fresh);
  }
  const chat = chatSessions.get(key)!;
  const currentModel = modelOverride || await getModel();
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
  reasoning?: string;
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
  reasoning?: string;
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
        const parts: any[] = [];
        if (typeof m.content === 'string') {
          parts.push({ text: m.content || ' ' });
        } else if (Array.isArray(m.content)) {
          for (const part of m.content as any[]) {
            if (part.text) {
              parts.push({ text: part.text });
            } else if (part.type === 'text') {
              parts.push({ text: part.text || ' ' });
            } else if (part.inlineData) {
              parts.push({ inlineData: part.inlineData });
            } else if (part.type === 'image_url' && part.image_url?.url?.startsWith('data:')) {
              // Convert OpenAI-style base64 image to Gemini format
              const dataUrl = part.image_url.url;
              const matches = dataUrl.match(/^data:(.*);base64,(.*)$/);
              if (matches) {
                parts.push({ inlineData: { mimeType: matches[1], data: matches[2] } });
              }
            }
          }
        }

        if (parts.length === 0) parts.push({ text: ' ' });

        if (lastRole === 'user') {
          const lastMsg = history[history.length - 1];
          lastMsg.parts.push(...parts);
        } else {
          history.push({ role: 'user', parts });
          lastRole = 'user';
        }
      } else if (m.role === 'assistant') {
        const parts: any[] = [];
        if (m.content) parts.push({ text: m.content });
        if (m.tool_calls) {
          m.tool_calls.forEach(tc => {
            try {
              parts.push({
                functionCall: {
                  name: tc.function.name,
                  args: JSON.parse(tc.function.arguments)
                }
              });
            } catch (e) {
              loggerService.catWarn(LogCategory.INFERENCE, "Failed to parse tool arguments for Gemini history", { tool: tc.function.name });
            }
          });
        }

        if (parts.length === 0) parts.push({ text: ' ' });

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
  let reasoningAccumulator = "";
  const collectedToolCalls = new Map<number, ChatCompletionMessageToolCall>();

  for await (const part of stream) {
    const delta = part.choices?.[0]?.delta;
    if (!delta) continue;

    // Capture Reasoning Content (Thinking)
    if ((delta as any).reasoning_content) {
      const reasoning = (delta as any).reasoning_content;
      reasoningAccumulator += reasoning;
      loggerService.catDebug(LogCategory.INFERENCE, "OpenAI stream: reasoning delta", { length: reasoning.length, preview: reasoning.slice(0, 200), deltaKeys: Object.keys(delta) });
      yield { reasoning };
    }

    const textChunk = extractTextDelta(delta);
    if (textChunk) {
      textAccumulator += textChunk;
      loggerService.catDebug(LogCategory.INFERENCE, "OpenAI stream: text delta", { length: textChunk.length, preview: textChunk.slice(0, 80), deltaKeys: Object.keys(delta) });
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

  if (reasoningAccumulator) {
    (assistantMessage as any).reasoning_content = reasoningAccumulator;
  }

  yield { assistantMessage };
};

export const resolveAttachments = async (message: string): Promise<{ resolvedContent: string; attachments: Attachment[] }> => {
  const attachmentRegex = /<attachments>([\s\S]*?)<\/attachments>/;
  const match = message.match(attachmentRegex);
  if (!match) return { resolvedContent: message, attachments: [] };

  try {
    const jsonStr = match[1];
    const attachmentRefs = JSON.parse(jsonStr);
    if (!Array.isArray(attachmentRefs)) return { resolvedContent: message, attachments: [] };

    const resolvedAttachments: Attachment[] = [];
    let resolvedContentStr = "\n\n--- Attachments ---\n";
    for (const ref of attachmentRefs) {
      if (ref.id) {
        const attachment = await attachmentService.getAttachment(ref.id);
        if (attachment) {
          resolvedAttachments.push(attachment);
          resolvedContentStr += `\n[File: ${attachment.filename} (${attachment.mime_type})]\n${attachment.content}\n`;
          if (attachment.structured_data?.analysis_model) {
            resolvedContentStr += `(Analysis by ${attachment.structured_data.analysis_model})\n`;
          }
        } else {
          resolvedContentStr += `\n[Attachment ${ref.id} not found or expired]\n`;
        }
      }
    }
    return { resolvedContent: message.replace(match[0], resolvedContentStr), attachments: resolvedAttachments };
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
  priority: number = 1, // Default to High (User Chat)
  cleanMessage?: string,
  sceneAttachments?: any[],
  metadata?: Record<string, any>
): AsyncGenerator<
  { text?: string; reasoning?: string; toolCalls?: any[]; isComplete?: boolean },
  void,
  unknown
> {
  const correlationId = userMessageId || randomUUID();
  const { resolvedContent, attachments: userAttachments } = await inferenceService.resolveAttachments(message);

  const attachments = [...userAttachments, ...(sceneAttachments || [])];

  if (attachments.length > 0) {
    loggerService.catDebug(LogCategory.INFERENCE, `Preparing multimodal inference with ${attachments.length} image part(s).`);
  }

  if (systemInstruction && chat.systemInstruction !== systemInstruction) {
    chat.messages = [{ role: "system", content: systemInstruction }];
    chat.systemInstruction = systemInstruction;
  }

  if (contextSessionId) {
    await contextService.recordMessage(contextSessionId, {
      id: correlationId,
      role: "user",
      content: cleanMessage || message, // Use cleanMessage for history
      timestamp: new Date().toISOString(),
      metadata: {
        ...metadata,
        kind: metadata?.is_autonomous ? "autonomous_trigger" : "user_prompt",
        ...(attachments.length > 0 ? { attachments } : {})
      },
    } as any);
  }

  const settings = await settingsService.getInferenceSettings();
  await inferenceLock.acquire(priority, chat.model, settings.provider || 'local');

  try {
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
      if (inferenceService.isCancelled) {
        loggerService.catInfo(LogCategory.INFERENCE, "Inference cancelled by user.");
        yield { text: "[Stopped]", isComplete: true };
        break;
      }
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
      let textWasStreamed = false;

      while (retries < MAX_RETRIES) {
        let contextMessages: ChatCompletionMessageParam[] = [];
        const settings = await settingsService.getInferenceSettings();

        if (contextSessionId) {
          const result = await contextWindowService.constructContextWindow(contextSessionId, systemInstruction || chat.systemInstruction);
          contextMessages = result.messages;

          if (loops === 0) {
            const lastUserMsgIdx = contextMessages.findLastIndex(m => m.role === 'user');
            if (lastUserMsgIdx !== -1) {
              const userMsg = contextMessages[lastUserMsgIdx];

              // Priority logic for first turn content:
              // 1. If we have an augmented message (scene context prepended), 
              //    we need to replace the original part of it with resolvedContent (user files)
              let finalUserContentText = message || resolvedContent;

              if (message && message !== resolvedContent) {
                // We have scene context prepended to 'message'
                // We must ensure the 'user message' part of that is also resolved
                const sceneBlockMatch = message.match(/^(\[Realtime Scene Context\][\s\S]*?---\n\n)/);
                if (sceneBlockMatch) {
                  const { resolvedContent: resolvedUserPart } = await inferenceService.resolveAttachments(message.replace(sceneBlockMatch[1], ""));
                  finalUserContentText = sceneBlockMatch[1] + resolvedUserPart;
                } else {
                  const { resolvedContent: resolvedFull } = await inferenceService.resolveAttachments(message);
                  finalUserContentText = resolvedFull;
                }
              }

              // 2. Inject Multimodal Data (Pixels) if available
              if (attachments.length > 0) {
                if (settings.provider === 'gemini') {
                  const contentParts: any[] = [{ text: finalUserContentText }];
                  for (const att of attachments) {
                    if (att.image_base64) {
                      contentParts.push({ inlineData: { data: att.image_base64, mimeType: att.mime_type || 'image/jpeg' } });
                    }
                  }
                  contextMessages[lastUserMsgIdx] = { ...userMsg, content: contentParts as any };
                } else if (settings.provider === 'openai' || settings.provider === 'local' || settings.provider === 'kimi2') {
                  const contentParts: any[] = [{ type: 'text', text: finalUserContentText }];
                  for (const att of attachments) {
                    if (att.image_base64) {
                      contentParts.push({ type: 'image_url', image_url: { url: `data:${att.mime_type || 'image/jpeg'};base64,${att.image_base64}` } });
                    }
                  }
                  contextMessages[lastUserMsgIdx] = { ...userMsg, content: contentParts as any };
                  loggerService.catDebug(LogCategory.INFERENCE, `Final user content updated with ${contentParts.length} parts (text + images).`);
                }
              } else {
                userMsg.content = finalUserContentText;
                loggerService.catDebug(LogCategory.INFERENCE, "Final user content updated (text only).");
              }
            }
          }
          eventBusService.emitKernelEvent(KernelEventType.INFERENCE_TOKENS, { sessionId: contextSessionId, totalTokens: result.totalTokens } as const);
        } else {
          const finalUserContentText = message || resolvedContent;
          let userContent: any = finalUserContentText;
          if (attachments.length > 0) {
            if (settings.provider === 'gemini') {
              userContent = [{ text: finalUserContentText }];
              for (const att of attachments) {
                if (att.image_base64) userContent.push({ inlineData: { data: att.image_base64, mimeType: att.mime_type || 'image/jpeg' } });
              }
            } else if (settings.provider === 'openai' || settings.provider === 'local' || settings.provider === 'kimi2') {
              userContent = [{ type: 'text', text: finalUserContentText }];
              for (const att of attachments) {
                if (att.image_base64) userContent.push({ type: 'image_url', image_url: { url: `data:${att.mime_type || 'image/jpeg'};base64,${att.image_base64}` } });
              }
            }
          }
          contextMessages = [{ role: 'system', content: systemInstruction || chat.systemInstruction }, { role: 'user', content: userContent }] as ChatCompletionMessageParam[];
        }

        if (transientMessages.length > 0) contextMessages = [...contextMessages, ...transientMessages];

        if (loops === 0) {
          if (anticipatedWebBrief) {
            contextMessages.push({ role: 'system', content: `\n\n[ANTICIPATED WEB SEARCH BRIEF]\n${anticipatedWebBrief}` });
          } else           if (anticipatedWebResults && anticipatedWebResults.length > 0) {
            contextMessages.push({ role: 'system', content: `\n\n[ANTICIPATED WEB SEARCH RESULTS]\n${JSON.stringify(anticipatedWebResults, null, 2)}` });
          }
        }

        let activeToolList = [...await getPrimaryTools()];
        if (contextSessionId) {
          try {
            const currentSession = await contextService.getSession(contextSessionId);
            const requestedTools = currentSession?.metadata?.active_tools || [];
            const secondaryTools = requestedTools.map((name: string) => SECONDARY_TOOLS_MAP[name]).filter(Boolean);
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
          if (chunk.text) { rawTextInTurn += chunk.text; textWasStreamed = true; }
          if (chunk.toolCalls) { yieldedToolCalls = chunk.toolCalls; yield { toolCalls: chunk.toolCalls }; }
          if (chunk.assistantMessage) nextAssistant = chunk.assistantMessage;
        }

        textAccumulatedInTurn = stripThoughts(rawTextInTurn);
        if (rawTextInTurn.trim() || (yieldedToolCalls && yieldedToolCalls.length > 0)) {
          if (!textAccumulatedInTurn.trim() && rawTextInTurn.trim()) {
            loggerService.catDebug(LogCategory.INFERENCE, "Model provided reasoning but empty final content.", {
              contextSessionId,
              rawLength: rawTextInTurn.length
            });
          }
          break;
        }
        retries++;
        loggerService.catWarn(LogCategory.INFERENCE, `Empty model response. Retry ${retries}/${MAX_RETRIES}...`, {
          contextSessionId,
          rawOutputPreview: rawTextInTurn.slice(0, 100)
        });
      }

      if (!nextAssistant) { yield { text: "Error: No assistant message returned." }; break; }

      if ((nextAssistant as any).tool_calls) {
        for (const call of (nextAssistant as any).tool_calls) {
          const { error: parseError } = parseToolArguments(call.function.arguments || "");
          if (parseError) { call.function.arguments = "{}"; }
        }
      }

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
              await contextService.recordMessage(contextSessionId, { id: randomUUID(), role: "tool", content: JSON.stringify(errorPayload), timestamp: new Date().toISOString(), toolName, toolCallId: call.id, metadata: { kind: "tool_error" }, correlationId: correlationId } as any);
            }
            continue;
          }

          try {
            const result = await toolExecutor(toolName, args);
            toolResponses.push({ role: "tool", content: JSON.stringify(result), tool_call_id: call.id });
            if (contextSessionId) {
              await contextService.recordMessage(contextSessionId, { id: randomUUID(), role: "tool", content: JSON.stringify(result), timestamp: new Date().toISOString(), toolName, toolCallId: call.id, metadata: { kind: "tool_result" }, correlationId: correlationId } as any);
            }
          } catch (err) {
            toolResponses.push({ role: "tool", content: JSON.stringify({ error: String(err) }), tool_call_id: call.id });
            if (contextSessionId) {
              await contextService.recordMessage(contextSessionId, { id: randomUUID(), role: "tool", content: JSON.stringify({ error: String(err) }), timestamp: new Date().toISOString(), toolName, toolCallId: call.id, metadata: { kind: "tool_error" }, correlationId: correlationId } as any);
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

      if (isEndingTurn && ENABLE_SYSTEM_AUDIT && auditRetries < MAX_AUDIT_RETRIES) {
        if (!traceSatisfied) {
          auditMessage += "⚠️ SYSTEM AUDIT FAILURE: YOU MUST TRACE THIS OPERATION! Call `log_trace` immediately.\n";
          auditTriggered = true;
        }
      }

      if (auditTriggered) {
        if (auditRetries < MAX_AUDIT_RETRIES) {
          transientMessages.push(nextAssistant!);
          if (toolResponses.length > 0) transientMessages.push(...toolResponses);
          transientMessages.push({ role: "user", content: `[SYSTEM AUDIT] ${auditMessage}` });
          auditRetries++;
          // Flag that the next turn is a recovery from an audit failure
          (nextAssistant as any)._audit_failure_trigger = true;
          continue;
        } else {
          auditTriggered = false;
        }
      }

      // --- NARRATIVE RECOVERY PROTOCOL ---
      // If the PREVIOUS turn was an audit failure, and THIS turn is trying to end with just a narrative
      // that describes the failure or apologizes for it, we throw it away and go one more loop.
      const lastTurnWasAuditFailure = transientMessages.length > 0 && (transientMessages[transientMessages.length - 1] as any).role === 'user' && (transientMessages[transientMessages.length - 1] as any).content?.includes('[SYSTEM AUDIT]');

      if (lastTurnWasAuditFailure && isEndingTurn && hasNarrativeOutput) {
        const auditCheckPrompt = `Analyze the following assistant response. Is this response primarily an apology, a meta-commentary about a system error, or a statement about failing an audit (e.g., "I forgot to log a trace", "I will now log a trace", "I apologize for the oversight")?
          
RESPONSE:
"${textAccumulatedInTurn}"

Return ONLY 'YES' if it is a failure narrative/apology, or 'NO' if it contains actual useful content or a valid conclusion.`;

        try {
          const auditResult = await callFastInference([{ role: 'user', content: auditCheckPrompt }], 20, undefined, LlamaPriority.URGENT);
          if (auditResult.toUpperCase().includes('YES')) {
            loggerService.catInfo(LogCategory.INFERENCE, "Audit Failure Narrative detected. Discarding and forcing retry loop.", {
              contextSessionId,
              narrative: textAccumulatedInTurn.slice(0, 50) + "..."
            });

            // Discard the text from this turn
            textAccumulatedInTurn = "";

            // Add this assistant message to transient so the model sees its own mistake
            transientMessages.push(nextAssistant!);
            if (toolResponses.length > 0) transientMessages.push(...toolResponses);

            // Add a nudge to actually do the work
            transientMessages.push({
              role: "user",
              content: "[SYSTEM RECOVERY] That narrative was an apology for an audit failure. DO NOT apologize. Just execute the required tools and provide the final synthesis now."
            });

            loops++;
            continue;
          }
        } catch (e) {
          loggerService.catError(LogCategory.INFERENCE, "Audit narrative check failed", { error: e });
        }
      }

      if (totalTextAccumulatedAcrossLoops.length > 0 && textAccumulatedInTurn.trim().length > 0) {
        totalTextAccumulatedAcrossLoops += "\n\n" + textAccumulatedInTurn;
      } else {
        totalTextAccumulatedAcrossLoops += textAccumulatedInTurn;
      }

      if (isEndingTurn && totalTextAccumulatedAcrossLoops.trim().length > 0 && !textWasStreamed) yield { text: totalTextAccumulatedAcrossLoops.trim() };

      // Record Assistant message if it contained tool calls OR if it's the final turn
      if (contextSessionId && nextAssistant) {
        const hasTools = (nextAssistant as any).tool_calls && (nextAssistant as any).tool_calls.length > 0;
        const reasoning = (nextAssistant as any).reasoning_content;

        if (hasTools || isEndingTurn) {
          await contextService.recordMessage(contextSessionId, {
            id: randomUUID(),
            role: "assistant",
            content: isEndingTurn ? stripThoughts(totalTextAccumulatedAcrossLoops) : (nextAssistant.content as string || ""),
            timestamp: new Date().toISOString(),
            toolCalls: (nextAssistant as any).tool_calls?.map((call: any) => ({ id: call.id, name: call.function?.name, arguments: call.function?.arguments })),
            metadata: {
              kind: hasTools ? "assistant_tool_call" : "assistant_response",
              ...(reasoning ? { reasoning_content: reasoning } : {})
            },
            correlationId: correlationId
          } as any);
        }
      }

      transientMessages.push(nextAssistant!);
      if (toolResponses.length > 0) transientMessages.push(...toolResponses);

      if (isEndingTurn) {
        if (contextSessionId) {
          try {
            const session = await contextService.getSession(contextSessionId);
            if (session && (!session.name || session.name.startsWith('Context '))) {
              const history = await contextService.getUnfilteredHistory(contextSessionId);
              if (history.length >= 2 && history.length <= 4) {
                const historyText = history.filter(m => m.role !== 'system').map(m => `${m.role.toUpperCase()}: ${stripThoughts(m.content || "").slice(0, 200)}`).join('\n');
                const namingPrompt = `Based on the following start of a conversation, generate a very concise (2-4 words) natural language title for this chat. Output ONLY the title text.\n\n${historyText}\n\nTITLE:`;

                void callFastInference([{ role: "user", content: namingPrompt }], 1024, undefined, LlamaPriority.URGENT).then(async (newName) => {
                  if (newName) {
                    const cleanName = newName.replace(/^["']|["']$/g, '').slice(0, 50);
                    await contextService.updateSession({ ...session, name: cleanName });
                    eventBusService.emitKernelEvent(KernelEventType.CONTEXT_UPDATED, { sessionId: contextSessionId, name: cleanName } as const);
                  }
                }).catch(() => { });
              }
            }
          } catch (namingError) { }
        }
        break;
      }

      if (auditRetries >= MAX_AUDIT_RETRIES) break;
      yieldedToolCalls = undefined;
      loops++;
    }

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
          const sessionSnapshot = { summary: session.summary, metadata: session.metadata };
          void summarizeHistory(historySegment, sessionSnapshot.summary).then(async (newSummary) => {
            if (newSummary !== sessionSnapshot.summary) {
              const updatedSession = await contextService.getSession(contextSessionId);
              if (updatedSession && updatedSession.summary !== newSummary) {
                updatedSession.summary = newSummary;
                updatedSession.metadata = { ...(updatedSession.metadata || {}), lastSummarizedRoundCount: lastSummarizedCount + roundsToSummarizeCount };
                await contextService.updateSession(updatedSession);
              }
            }
          }).catch(() => { });
        }
      } catch (err) { }
    }
  } finally {
    inferenceLock.release();
    _isCancelled = false;
  }

  yield { isComplete: true };
}

export const extractJson = async (text: string): Promise<any> => {
  if (!text || text.trim() === "") return null;

  try {
    const result = await workerService.runTask('parseJson', text);
    if (result) return result;
  } catch (e) { }

  const sanitize = (str: string) => {
    return str
      // Fix invalid backslashes (common in LaTeX or math output)
      .replace(/\\(?![bfnrtu"\/])/g, "\\\\")
      // Handle literal newlines inside values
      .replace(/\n/g, "\\n")
      // Remove common LLM conversational prefixes/suffixes
      .replace(/^.*?({|\[)/, (m) => m.endsWith('[') ? '[' : '{')
      .replace(/(}|\])[^}\]]*$/, (m) => m.startsWith(']') ? ']' : '}');
  };

  const tryParse = (str: string) => {
    try {
      return JSON.parse(str);
    } catch (e) {
      // If it looks like multiple objects { ... }, { ... }, wrap and merge
      if (str.includes('}, {') || str.includes('},\n{')) {
        try {
          const wrapped = JSON.parse(`[${str}]`);
          if (Array.isArray(wrapped)) {
            return wrapped.reduce((acc, obj) => ({ ...acc, ...obj }), {});
          }
        } catch (inner) { }
      }

      // Deep heuristic for unescaped internal quotes
      let fixed = str
        .replace(/":\s*"([\s\S]*?)"(\s*[,}\n])/g, (_match, p1, p2) => {
          const content = p1
            .replace(/\\"/g, '"') // Normalize existing escapes
            .replace(/"/g, '\\"'); // Re-escape all
          return `": "${content}"${p2}`;
        })
        .replace(/,(\s*[}\]])/g, '$1');

      try {
        return JSON.parse(fixed);
      } catch (inner) {
        // Recovery for truncated JSON
        let truncated = fixed.trim();
        if ((truncated.startsWith('{') && !truncated.endsWith('}')) || (truncated.startsWith('[') && !truncated.endsWith(']'))) {
          const stack: string[] = [];
          for (let i = 0; i < truncated.length; i++) {
            if (truncated[i] === '{') stack.push('}');
            else if (truncated[i] === '[') stack.push(']');
            else if (truncated[i] === '}' || truncated[i] === ']') stack.pop();
          }
          while (stack.length > 0) {
            truncated += stack.pop();
          }
          try {
            return JSON.parse(truncated);
          } catch (deepInner) {
            return null;
          }
        }
        return null;
      }
    }
  };

  const direct = tryParse(text);
  if (direct) return direct;

  const sanitized = tryParse(sanitize(text));
  if (sanitized) return sanitized;

  // Regex fallback for code blocks
  const jsonRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
  let match;
  while ((match = jsonRegex.exec(text)) !== null) {
    const extracted = tryParse(sanitize(match[1]));
    if (extracted) return extracted;
  }

  // Final fallback: Balanced brace extraction
  const firstBrace = text.indexOf('{');
  if (firstBrace !== -1) {
    let balanced = "";
    let count = 0;
    for (let i = firstBrace; i < text.length; i++) {
      if (text[i] === '{') count++;
      if (text[i] === '}') count--;
      balanced += text[i];
      if (count === 0) break;
    }
    const extracted = tryParse(sanitize(balanced));
    if (extracted) return extracted;
  }

  loggerService.catError(LogCategory.INFERENCE, "All JSON extraction attempts failed. FULL LLM OUTPUT BELOW:", {
    fullText: text
  });
  throw new Error("JSON extraction failed");
};

export const summarizeHistory = async (history: ContextMessage[], currentSummary?: string): Promise<string> => {
  const cleanHistory = contextWindowService.stripTools(history);
  const historyText = cleanHistory.map(m => `${m.role.toUpperCase()}: ${stripThoughts(m.content || "")}`).join('\n');
  const prompt = `Summarize the following conversation concisely: ${currentSummary ? `Previous Summary: ${currentSummary}\n` : ''} \n\nRecent Conversation History:\n${historyText}\n\nREFINED SUMMARY:`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const summary = await callFastInference([{ role: "user", content: prompt }], 8192, undefined, LlamaPriority.URGENT
      );
      if (summary && summary.trim()) return summary.trim();
    } catch (error) {
      if (attempt === 2) return currentSummary || "";
    }
    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
  }
  return currentSummary || "";
};

export const synthesizeWebResults = async (
  queryResults: { query: string, results: { title: string, snippet: string, url: string }[] }[]
): Promise<string> => {
  if (queryResults.length === 0) return "";
  let resultsText = "";
  queryResults.forEach(qr => {
    resultsText += `\n[RESULTS FOR QUERY: "${qr.query}"]\n`;
    qr.results.forEach((r, i) => {
      // Allow more detail per result
      resultsText += `${i + 1}. ${r.title}\n   Full Snippet: ${r.snippet}\n   URL: ${r.url}\n`;
    });
  });
  const prompt = `Synthesize these research results into a dense, high-fidelity Knowledge Brief. Use all the details provided to build a comprehensive view of the topic.\n\nResearch Data:\n${resultsText}\n\nKNOWLEDGE BRIEF:`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const brief = await callFastInference([{ role: "user", content: prompt }], 8192, undefined, LlamaPriority.URGENT);
      if (brief && brief.trim()) return brief.trim();
    } catch (error) {
      if (attempt === 2) return "";
    }
    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
  }
  return "";
};

export const primeSymbolicContext = async (
  message: string,
  contextSessionId: string
): Promise<{
  symbols: SymbolDef[],
  webResults: any[],
  webBrief?: string,
  traceNeeded: boolean,
  traceReason?: string
}> => {
  const foundSymbols: SymbolDef[] = [];
  const webResults: any[] = [];
  let traceNeeded = true;
  let traceReason: string | undefined;
  let webBrief: string | undefined;

  try {
    const session = await contextService.getSession(contextSessionId);
    const history = await contextService.getUnfilteredHistory(contextSessionId);

    // Build minimal priming context: last 3 user messages + single last AI message
    const userMsgs = history.filter(m => m.role === 'user');
    const lastThreeUser = userMsgs.slice(-3).map(m => `USER: ${stripThoughts(m.content || "")}`);
    const lastAi = [...history].reverse().find(m => m.role === 'assistant' || m.role === 'model');
    const aiMsg = lastAi ? `\nASSISTANT: ${stripThoughts(lastAi.content || "")}` : '';
    const historyContext = [...lastThreeUser, aiMsg].filter(Boolean).join('\n');

    // Identify previous web searches to avoid duplicates
    const previousSearches = history
      .flatMap(m => {
        const searches: string[] = [];
        if (m.toolName === 'web_search' && (m as any).toolArgs?.query) searches.push((m as any).toolArgs.query);
        if (m.metadata?.kind === 'anticipated_web_search' && Array.isArray(m.metadata?.queries)) {
          m.metadata.queries.forEach((q: string) => searches.push(q));
        }
        return searches;
      })
      .filter((q, i, self) => q && self.indexOf(q) === i);

    const currentName = session?.name;
    const userMessageCount = userMsgs.length + 1;
    const needsNaming = !currentName || currentName.startsWith('Context ') || (userMessageCount % 10 === 0);

    loggerService.catInfo(LogCategory.INFERENCE, "Priming symbolic context via Llama Sidecar", {
      contextSessionId,
      userMsgsIncluded: lastThreeUser.length,
      hasAiMsg: !!lastAi,
      needsNaming
    });

    const prompt = `You are a high-speed symbolic priming engine. 
    CRITICAL: DO NOT use any <think> tags. DO NOT reason out loud. DO NOT output any text other than the JSON object.
    
    Analyze the conversation history and the new user message to identify 3 symbolic search queries and determine if web search grounding is needed. 
    
    Additionally, generate 2 "orthogonal_queries" that explore the local opposite of your predictions, including antonyms, contradictory logic, or orthogonal concepts to ensure context diversity.
    
    ${needsNaming ? 'CRITICAL: Based on the conversation context, suggest a descriptive and concise name for this context session in "suggested_name".' : ''}

    CRITICAL: Only set "web_search_needed" to true if the message involves an external entity (person, company, place), a complex technical/scientific topic, or a current event that requires grounding in facts.

    Conversation History:
    ${historyContext || "No previous history."}

    New User Message: "${message}"

    Previous Web Searches (DO NOT REPEAT THESE):
    ${previousSearches.length > 0 ? previousSearches.join(', ') : "None."}

    Output the following valid JSON object IMMEDIATELY without any preamble, explanation, or thinking:
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
    const fastText = await callFastInference([{ role: "user", content: prompt }], 2048, undefined, LlamaPriority.URGENT);
    fastResponse = extractJson(fastText);

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
      void contextService.renameSession(contextSessionId, cleanName).then(() => {
        eventBusService.emitKernelEvent(KernelEventType.CONTEXT_UPDATED, { sessionId: contextSessionId, name: cleanName } as const);
      }).catch(() => { });
    }

    if (symbolicQueries.length > 0) {
      loggerService.catInfo(LogCategory.INFERENCE, `Executing ${symbolicQueries.length} symbolic search queries.`, { symbolicQueries });
      const searchResults = await Promise.all(symbolicQueries.map(q => domainService.search(q, 5)));
      for (const res of searchResults) {
        res.forEach((r: any) => { if (!foundSymbols.find(s => s.id === r.id)) foundSymbols.push(r.metadata as SymbolDef); });
      }
      loggerService.catInfo(LogCategory.INFERENCE, `Symbolic Store returned ${foundSymbols.length} unique symbols for precache.`);
      if (foundSymbols.length > 0) {
        const { added, updated } = await symbolCacheService.batchUpsertSymbols(contextSessionId, foundSymbols);
        loggerService.catInfo(LogCategory.INFERENCE, `Primed cache: ${added} new, ${updated} filtered/updated.`);
        await symbolCacheService.emitCacheLoad(contextSessionId);
      }
    }

    if (fastResponse.web_search_needed && webSearchQueries.length > 0) {
      const searchPromises = webSearchQueries.map(async (q) => {
        try {
          const { results, provider } = await webSearchService.search(q);
          if (results.length > 0) {
            return { query: q, results: results.slice(0, 5), provider };
          }
        } catch (e) {
          loggerService.catError(LogCategory.INFERENCE, "Anticipated web search failed", { query: q, error: e });
        }
        return null;
      });
      const webSearchResults = (await Promise.all(searchPromises)).filter(Boolean);
      for (const wr of webSearchResults as typeof webResults) {
        webResults.push(wr);
      }
      if (webResults.length > 0) {
        webBrief = await synthesizeWebResults(webResults);
        await contextService.recordMessage(contextSessionId, {
          id: randomUUID(), role: "system", content: `[System] Executed ${webResults.length} anticipated web searches for grounding.`,
          timestamp: new Date().toISOString(), metadata: { kind: "anticipated_web_search", queries: webSearchQueries, resultsCount: webResults.length }
        } as any);
      }
    }
  } catch (e) { loggerService.catError(LogCategory.INFERENCE, "Priming failed", { error: e }); }
  return { symbols: foundSymbols, webResults, webBrief, traceNeeded, traceReason };
};

export const processMessageAsync = async (
  contextSessionId: string,
  message: string,
  toolExecutor: (name: string, args: any) => Promise<any>,
  systemInstruction: string,
  messageId?: string,
  metadata?: Record<string, any>
) => {
  eventBusService.emitKernelEvent(KernelEventType.INFERENCE_STARTED, { contextSessionId } as const);
  let messageTraceNeeded = false;
  try {
    const sceneSnapshot = await realtimeService.getSnapshot();
    let augmentedMessage = message;
    const sceneAttachments: any[] = [];

    if (sceneSnapshot) {
      // 1. Extract and remove heavy base64 from the textual snapshot
      if (sceneSnapshot.camera?.lastFrame) {
        const raw = sceneSnapshot.camera.lastFrame;
        const data = raw.includes(',') ? raw.split(',')[1] : raw;
        sceneAttachments.push({
          id: 'scene-camera',
          mime_type: 'image/jpeg',
          image_base64: data,
          filename: 'camera_perception.jpg'
        });
        loggerService.catInfo(LogCategory.INFERENCE, `Extracted Camera Frame: ${Math.round(data.length / 1024)}KB`);
        delete sceneSnapshot.camera.lastFrame;
      }
      if (sceneSnapshot.screen?.lastFrame) {
        const raw = sceneSnapshot.screen.lastFrame;
        const data = raw.includes(',') ? raw.split(',')[1] : raw;
        sceneAttachments.push({
          id: 'scene-screen',
          mime_type: 'image/jpeg',
          image_base64: data,
          filename: 'screen_perception.jpg'
        });
        loggerService.catInfo(LogCategory.INFERENCE, `Extracted Screen Frame: ${Math.round(data.length / 1024)}KB`);
        delete sceneSnapshot.screen.lastFrame;
      }

      // 2. Format the structured metadata (OCR, emotions, etc)
      const sceneContextBlock = `[Realtime Scene Context]\n${JSON.stringify(sceneSnapshot, null, 2)}\n\n---\n\n`;

      // 3. Prepend to message (which sendMessageAndHandleTools will later merge with resolvedContent)
      augmentedMessage = sceneContextBlock + message;
    }

    const speakerName = metadata?.voice_authenticated_username;
    let finalSystemInstruction = systemInstruction;

    if (speakerName && speakerName !== 'Unknown') {
      finalSystemInstruction = `${finalSystemInstruction}\n\n[Voice Authentication Metadata]\n- Current Speaker: ${speakerName}\n- Verification Status: Authenticated via Voice Fingerprint`;
    }

    const { webResults, webBrief, traceNeeded, traceReason } = await primeSymbolicContext(message, contextSessionId);
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
          trace_reason: traceReason,
          voice_authenticated_username: speakerName
        }
      });
    }
    const chat = await getChatSession(finalSystemInstruction, contextSessionId);

    // Increment turns AFTER load so that newly loaded/refreshed symbols have turnCount 0 (touched)
    // and only then get incremented to 1, avoiding immediate eviction.
    await symbolCacheService.incrementTurns(contextSessionId);
    await tentativeLinkService.incrementTurns();

    const stream = sendMessageAndHandleTools(chat, augmentedMessage, toolExecutor, messageTraceNeeded, finalSystemInstruction, contextSessionId, messageId, webResults, webBrief, 1, message, sceneAttachments, metadata);

    const isSilent = metadata?.silent === true;
    if (!isSilent) {
      eventBusService.emitKernelEvent(KernelEventType.INFERENCE_STARTED, { sessionId: contextSessionId, messageId } as const);
    }

    let fullText = "";
    for await (const chunk of stream) {
      if (chunk.text) fullText += chunk.text;
      if (!isSilent && (chunk.text || chunk.toolCalls || chunk.reasoning)) {
        loggerService.catDebug(LogCategory.INFERENCE, "processMessageAsync: emitting chunk", {
          hasText: !!chunk.text,
          textPreview: chunk.text?.slice(0, 80),
          hasReasoning: !!chunk.reasoning,
          reasoningPreview: chunk.reasoning?.slice(0, 200),
          toolCallCount: chunk.toolCalls?.length || 0,
          isComplete: !!chunk.isComplete
        });
        eventBusService.emitKernelEvent(KernelEventType.INFERENCE_CHUNK, { ...chunk, sessionId: contextSessionId, messageId } as const);
      }
      if (chunk.isComplete) {
        if (!isSilent) {
          eventBusService.emitKernelEvent(KernelEventType.INFERENCE_COMPLETED, {
            sessionId: contextSessionId,
            messageId,
            fullText,
            metadata: { ...metadata }
          } as const);
        }
        return { fullText, sessionId: contextSessionId };
      }
    }
    return { success: false, reason: "Inference loop ended without completion flag" };
  } catch (error: any) {
    loggerService.catError(LogCategory.INFERENCE, "Async Message Processing Failed", { contextSessionId, error: error.message });
    eventBusService.emitKernelEvent(KernelEventType.INFERENCE_ERROR, { sessionId: contextSessionId, messageId, error: error.message } as const);
    return { success: false, error: error.message };
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
  resolveAttachments,
  callFastInference,
  setIsCancelled(val: boolean) { _isCancelled = val; },
  get isCancelled() { return _isCancelled; },
};
