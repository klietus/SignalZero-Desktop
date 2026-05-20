import { describe, it, expect, vi, beforeEach } from 'vitest';
import { inferenceService } from '../services/inferenceService.js';

// Mock dependencies
vi.mock('../services/settingsService.js', () => ({
  settingsService: {
    getInferenceSettings: vi.fn().mockResolvedValue({
      model: 'gemini-2.5-flash',
      provider: 'gemini',
      apiKey: 'test-key'
    }),
  }
}));

const mockSendMessageStream = vi.fn();
const mockStartChat = vi.fn().mockReturnValue({
  sendMessageStream: mockSendMessageStream
});

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: vi.fn().mockReturnValue({
      startChat: mockStartChat
    })
  })),
  SchemaType: { OBJECT: 'OBJECT' }
}));

vi.mock('../services/loggerService.js', () => ({
  loggerService: {
    catDebug: vi.fn(),
    catInfo: vi.fn(),
    catWarn: vi.fn(),
    catError: vi.fn(),
  },
  LogCategory: { INFERENCE: 'INFERENCE' }
}));

describe('Gemini Streaming thoughtSignature Capture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should capture thoughtSignature from stream chunks when SDK strips it from .response', async () => {
    const sig1 = 'stream-captured-sig-001';
    const sig2 = 'stream-captured-sig-002';

    // Simulate the Gemini SDK behavior:
    // - Stream chunks contain thoughtSignature on functionCall parts
    // - Final .response has thoughtSignature STRIPPED from parts
    mockSendMessageStream.mockResolvedValue({
      stream: (async function* () {
        yield {
          candidates: [{
            content: {
              parts: [
                { functionCall: { name: 'web_search', args: { query: 'SignalZero' } }, thoughtSignature: sig1 },
                { functionCall: { name: 'log_trace', args: { trace_id: 'test', step: 'verify' } }, thoughtSignature: sig2 }
              ]
            },
            finishReason: 'STOP'
          }]
        };
      })(),
      // SDK strips thoughtSignature from the final response
      response: Promise.resolve({
        candidates: [{
          content: {
            parts: [
              { functionCall: { name: 'web_search', args: { query: 'SignalZero' } } },
              { functionCall: { name: 'log_trace', args: { trace_id: 'test', step: 'verify' } } }
            ]
          },
          finishReason: 'STOP'
        }]
      })
    });

    const messages: any[] = [{ role: 'user', content: 'Search and trace.' }];
    const generator = inferenceService.streamAssistantResponse(messages, 'gemini-2.5-flash', []);
    
    let assistantMsg: any = null;
    for await (const chunk of generator) {
      if (chunk.assistantMessage) assistantMsg = chunk.assistantMessage;
    }

    expect(assistantMsg).not.toBeNull();
    expect(assistantMsg.tool_calls).toHaveLength(2);
    
    // Both tool calls should have thought_signature captured from stream
    expect(assistantMsg.tool_calls[0].thought_signature).toBe(sig1);
    expect(assistantMsg.tool_calls[1].thought_signature).toBe(sig2);
  });

  it('should fall back to direct field when present (non-streaming path)', async () => {
    const directSig = 'direct-sig-001';

    mockSendMessageStream.mockResolvedValue({
      stream: (async function* () {
        yield {
          candidates: [{
            content: { parts: [{ functionCall: { name: 'web_search', args: {} }, thoughtSignature: directSig }] },
            finishReason: 'STOP'
          }]
        };
      })(),
      response: Promise.resolve({
        candidates: [{
          content: { parts: [{ functionCall: { name: 'web_search', args: {} }, thoughtSignature: directSig }] },
          finishReason: 'STOP'
        }]
      })
    });

    const messages: any[] = [{ role: 'user', content: 'test' }];
    const generator = inferenceService.streamAssistantResponse(messages, 'gemini-2.5-flash', []);
    
    let assistantMsg: any = null;
    for await (const chunk of generator) {
      if (chunk.assistantMessage) assistantMsg = chunk.assistantMessage;
    }

    expect(assistantMsg.tool_calls[0].thought_signature).toBe(directSig);
  });

  it('should handle no signatures gracefully', async () => {
    mockSendMessageStream.mockResolvedValue({
      stream: (async function* () {
        yield {
          candidates: [{
            content: { parts: [{ functionCall: { name: 'web_search', args: {} } }] },
            finishReason: 'STOP'
          }]
        };
      })(),
      response: Promise.resolve({
        candidates: [{
          content: { parts: [{ functionCall: { name: 'web_search', args: {} } }] },
          finishReason: 'STOP'
        }]
      })
    });

    const messages: any[] = [{ role: 'user', content: 'test' }];
    const generator = inferenceService.streamAssistantResponse(messages, 'gemini-2.5-flash', []);
    
    let assistantMsg: any = null;
    for await (const chunk of generator) {
      if (chunk.assistantMessage) assistantMsg = chunk.assistantMessage;
    }

    expect(assistantMsg.tool_calls[0].thought_signature).toBeUndefined();
  });
});
