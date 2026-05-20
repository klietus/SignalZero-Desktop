import { describe, it, expect, vi, beforeEach } from 'vitest';
import { inferenceService } from '../services/inferenceService.js';
import { settingsService } from '../services/settingsService.js';

// Mock dependencies
vi.mock('../services/settingsService.js', () => ({
  settingsService: {
    getInferenceSettings: vi.fn().mockResolvedValue({
      model: 'gemini-2.0-flash-exp',
      provider: 'gemini',
      apiKey: 'test-key'
    }),
  }
}));

const mockSendMessageStream = vi.fn();
const mockStartChat = vi.fn().mockReturnValue({
  sendMessageStream: mockSendMessageStream
});

vi.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: vi.fn().mockReturnValue({
        startChat: mockStartChat
      })
    })),
    SchemaType: { OBJECT: 'OBJECT' }
  };
});

vi.mock('../services/loggerService.js', () => ({
  loggerService: {
    catDebug: vi.fn(),
    catInfo: vi.fn(),
    catWarn: vi.fn(),
    catError: vi.fn(),
  },
  LogCategory: {
    INFERENCE: 'INFERENCE',
  }
}));

describe('Gemini thought_signature Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should capture thought_signature from Gemini response and pass it back in history', async () => {
    const thoughtSignature = 'test-signature-123';
    
    // 1. Mock Gemini response with thought_signature
    const mockResponse = {
      candidates: [{
        content: {
          parts: [{
            functionCall: {
              name: 'test_tool',
              args: { arg1: 'val1' },
              thought_signature: thoughtSignature
            }
          }]
        },
        finishReason: 'STOP'
      }]
    };

    mockSendMessageStream.mockResolvedValue({
      stream: (async function* () {
        yield {
          candidates: mockResponse.candidates,
          functionCalls: () => [mockResponse.candidates[0].content.parts[0].functionCall],
          text: () => ''
        };
      })(),
      response: Promise.resolve(mockResponse)
    });

    const messages: any[] = [
      { role: 'user', content: 'Hello' }
    ];

    const generator = inferenceService.streamAssistantResponse(messages, 'gemini-2.0-flash-exp', []);
    
    let assistantMsg: any = null;
    for await (const chunk of generator) {
      if (chunk.assistantMessage) {
        assistantMsg = chunk.assistantMessage;
      }
    }

    expect(assistantMsg).not.toBeNull();
    expect(assistantMsg.tool_calls).toBeDefined();
    expect(assistantMsg.tool_calls[0].thought_signature).toBe(thoughtSignature);

    // 2. Verify that when we send history back, the thought_signature is included
    const historyMessages: any[] = [
      { role: 'user', content: 'Hello' },
      assistantMsg
    ];

    // Reset mock to check next call
    const secondMockResponse = {
      candidates: [{ content: { parts: [{ text: 'Response' }] }, finishReason: 'STOP' }],
      text: () => 'Response'
    };

    mockSendMessageStream.mockResolvedValue({
      stream: (async function* () {
        yield {
          candidates: secondMockResponse.candidates,
          functionCalls: () => [],
          text: () => 'Response'
        };
      })(),
      response: Promise.resolve(secondMockResponse)
    });

    const secondGenerator = inferenceService.streamAssistantResponse(historyMessages, 'gemini-2.0-flash-exp', []);
    for await (const _ of secondGenerator) {
      // just consume
    }

    expect(mockStartChat).toHaveBeenCalled();
    const lastCall = mockStartChat.mock.calls[mockStartChat.mock.calls.length - 1];
    const historyPassed = lastCall[0].history;
    
    const assistantHistoryMsg = historyPassed.find((m: any) => m.role === 'model');
    expect(assistantHistoryMsg).toBeDefined();
    const fcPart = assistantHistoryMsg.parts.find((p: any) => p.functionCall);
    expect(fcPart).toBeDefined();
    expect(fcPart.functionCall.thought_signature).toBe(thoughtSignature);
  });
});
