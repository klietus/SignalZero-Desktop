import OpenAI from "openai";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { randomUUID } from "crypto";
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";
import { PRIMARY_TOOLS, SECONDARY_TOOLS_MAP } from "./toolsService.js";
import { ACTIVATION_PROMPT } from "../symbolic_system/activation_prompt.js";
import { SymbolDef, ContextMessage, ContextKind } from "../types.js";
import { domainService } from "./domainService.js";
import { embedText } from "./embeddingService.js";
import { buildSystemMetadataBlock } from "./timeService.js";
import { settingsService } from "./settingsService.js";
import { loggerService } from './loggerService.js';
import { contextService } from './contextService.js';
import { symbolCacheService } from './symbolCacheService.js';
import { tentativeLinkService } from './tentativeLinkService.js';
import { contextWindowService } from './contextWindowService.js';
import { sqliteService } from './sqliteService.js';
import { mcpClientService } from './mcpClientService.js';

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

const extractTextDelta = (delta: ChatCompletionChunk["choices"][number]["delta"]) => {
  if (!delta?.content) return "";
  if (typeof delta.content === "string") return delta.content;
  if (Array.isArray(delta.content)) {
    return (delta.content as any[]).map((item: any) => item?.text || "").join("");
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
    if (last && last.role === msg.role && last.role !== 'tool' && !last.tool_calls && !msg.tool_calls) {
      last.content += "\n\n" + msg.content;
      continue;
    }
    normalized.push(msg);
  }
  return normalized;
};

const streamAssistantResponse = async function* (
  messages: ChatCompletionMessageParam[],
  model: string,
  activeTools: any[] = PRIMARY_TOOLS
): AsyncGenerator<{ text?: string; toolCalls?: ChatCompletionMessageToolCall[]; assistantMessage?: ChatCompletionMessageParam; }> {
  const settings = await settingsService.getInferenceSettings();
  if (settings.provider === 'gemini') {
    const client = await getGeminiClient();
    const geminiModel = client.getGenerativeModel({ model, tools: toGeminiTools(activeTools) });
    const systemMessage = messages.find(m => m.role === 'system');
    const history: any[] = [];
    messages.filter(m => m.role !== 'system').forEach(m => {
        // Simple mapping for Gemini history...
        if (m.role === 'user') history.push({ role: 'user', parts: [{ text: String(m.content) }] });
        else if (m.role === 'assistant') history.push({ role: 'model', parts: [{ text: String(m.content || "") }] });
    });
    const chat = geminiModel.startChat({ history, systemInstruction: systemMessage?.content ? String(systemMessage.content) : undefined });
    const lastMsg = messages[messages.length-1];
    const result = await chat.sendMessageStream(String(lastMsg.content || "Continue"));
    let textAcc = "";
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) { textAcc += text; yield { text }; }
    }
    yield { assistantMessage: { role: "assistant", content: textAcc } };
    return;
  }

  const client = await getClient();
  const stream = await client.chat.completions.create({ model, messages: normalizeMessages(messages), tools: activeTools, stream: true });
  let textAcc = "";
  const toolCalls = new Map<number, ChatCompletionMessageToolCall>();
  for await (const part of stream) {
    const delta = part.choices[0]?.delta;
    if (delta?.content) { textAcc += delta.content; yield { text: delta.content }; }
    if (delta?.tool_calls) mergeToolCallDelta(toolCalls, delta.tool_calls);
  }
  const completedCalls = Array.from(toolCalls.values());
  yield { toolCalls: completedCalls.length > 0 ? completedCalls : undefined, assistantMessage: { role: "assistant", content: textAcc, tool_calls: completedCalls.length > 0 ? completedCalls : undefined } };
};

export const stripThoughts = (text: string): string => {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim();
};

export async function* sendMessageAndHandleTools(
  chat: ChatSessionState,
  message: string,
  toolExecutor: (name: string, args: any) => Promise<any>,
  systemInstruction?: string,
  contextSessionId?: string
): AsyncGenerator<{ text?: string; toolCalls?: any[]; isComplete?: boolean }> {
  if (contextSessionId) {
    await contextService.recordMessage(contextSessionId, { id: randomUUID(), role: "user", content: message, timestamp: new Date().toISOString() });
    await symbolCacheService.incrementTurns(contextSessionId);
  }

  let loops = 0;
  while (loops < MAX_TOOL_LOOPS) {
    const contextMessages = contextSessionId 
        ? await contextWindowService.constructContextWindow(contextSessionId, systemInstruction || chat.systemInstruction)
        : [{ role: 'system', content: systemInstruction || chat.systemInstruction }, { role: 'user', content: message }] as ChatCompletionMessageParam[];

    const stream = streamAssistantResponse(contextMessages, chat.model);
    let turnText = "";
    let turnToolCalls: ChatCompletionMessageToolCall[] | undefined;
    let assistantMsg: ChatCompletionMessageParam | undefined;

    for await (const chunk of stream) {
      if (chunk.text) { turnText += chunk.text; yield { text: chunk.text }; }
      if (chunk.toolCalls) turnToolCalls = chunk.toolCalls;
      if (chunk.assistantMessage) assistantMsg = chunk.assistantMessage;
    }

    if (contextSessionId && assistantMsg) {
        await contextService.recordMessage(contextSessionId, {
            id: randomUUID(),
            role: "assistant",
            content: stripThoughts(turnText),
            timestamp: new Date().toISOString(),
            toolCalls: turnToolCalls?.map(tc => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments }))
        } as any);
    }

    if (!turnToolCalls || turnToolCalls.length === 0) break;

    for (const call of turnToolCalls) {
      const { data: args } = parseToolArguments(call.function.arguments);
      const result = await toolExecutor(call.function.name, args);
      if (contextSessionId) {
          await contextService.recordMessage(contextSessionId, {
              id: randomUUID(),
              role: "tool",
              content: JSON.stringify(result),
              timestamp: new Date().toISOString(),
              toolCallId: call.id,
              toolName: call.function.name
          } as any);
      }
    }
    loops++;
  }
  yield { isComplete: true };
}

export const primeSymbolicContext = async (message: string, contextSessionId: string) => {
    // Desktop version priming...
    return { symbols: [], webResults: [], traceNeeded: true };
};

export const summarizeHistory = async (history: ContextMessage[], currentSummary?: string): Promise<string> => {
    // Desktop history summarization...
    return currentSummary || "";
};
