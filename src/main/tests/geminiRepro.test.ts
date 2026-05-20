import { describe, it, expect, vi, beforeEach } from 'vitest';
import { inferenceService } from '../services/inferenceService.js';
import { randomUUID } from "crypto";

// Mock dependencies
vi.mock('../services/settingsService.js', () => ({
  settingsService: {
    getInferenceSettings: vi.fn().mockResolvedValue({
      model: 'gemini-3.5-flash',
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

describe('Gemini Inference Bug Reproduction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should capture thoughtSignature from sibling field on Part (Gemini wire format)', async () => {
    const thoughtSignature = 'sig-123';
    
    // Gemini wire format: thoughtSignature is a sibling to functionCall, not nested inside it
    const finalResponse = {
      candidates: [{
        content: {
          parts: [
            { thought: "Thinking..." },
            { text: "Narrative..." },
            {
              functionCall: {
                name: 'tool_1',
                args: { a: 1 }
              },
              thoughtSignature: thoughtSignature
            },
            {
              functionCall: {
                name: 'tool_2',
                args: { b: 2 }
              },
              thoughtSignature: thoughtSignature
            },
            {
              functionCall: {
                name: 'tool_3',
                args: { c: 3 }
              },
              thoughtSignature: thoughtSignature
            }
          ]
        },
        finishReason: 'STOP'
      }]
    };

    mockSendMessageStream.mockResolvedValue({
      stream: (async function* () {
        // Just yield the final state once for simplicity of testing the extraction
        yield {
          candidates: finalResponse.candidates,
          text: () => 'Narrative...'
        };
      })(),
      response: Promise.resolve(finalResponse)
    });

    const messages: any[] = [{ role: 'user', content: 'test' }];
    const generator = inferenceService.streamAssistantResponse(messages, 'gemini-3.5-flash', []);
    
    let assistantMsg: any = null;
    for await (const chunk of generator) {
      if (chunk.assistantMessage) {
        assistantMsg = chunk.assistantMessage;
      }
    }

    expect(assistantMsg.tool_calls.length).toBe(3);
    
    // Check all tool calls for signature
    assistantMsg.tool_calls.forEach((tc: any, i: number) => {
      console.log(`Tool call ${i} signature:`, tc.thought_signature);
      expect(tc.thought_signature).toBe(thoughtSignature);
    });

    // Check reasoning_content
    expect(assistantMsg.reasoning_content).toBe("Thinking...");
  });

  it('should carry over signatures during history conversion', async () => {
    const thoughtSignature = 'sig-789';
    const messages: any[] = [
      {
        role: 'assistant',
        content: 'I will call tools.',
        reasoning_content: 'Let me think...',
        tool_calls: [
          {
            id: '1',
            type: 'function',
            function: { name: 'tool_1', arguments: '{}' },
            thought_signature: thoughtSignature
          },
          {
            id: '2',
            type: 'function',
            function: { name: 'tool_2', arguments: '{}' }
            // Missing signature here!
          }
        ]
      }
    ];

    // Access the private mapToGeminiHistory or just use a message that triggers it
    // streamAssistantResponse calls mapToGeminiHistory internally
    mockSendMessageStream.mockResolvedValue({
      stream: (async function* () { yield { text: () => 'Done', candidates: [] }; })(),
      response: Promise.resolve({ candidates: [{ content: { parts: [{ text: 'Done' }] } }] })
    });

    const generator = inferenceService.streamAssistantResponse(messages, 'gemini-3.5-flash', []);
    for await (const chunk of generator) {
      // Consume the generator
    }

    // Verify what was sent to startChat
    const startChatCall = mockStartChat.mock.calls[0];
    const history = startChatCall[0].history;
    const assistantHistoryMsg = history[0];
    
    expect(assistantHistoryMsg.role).toBe('model');
    expect(assistantHistoryMsg.parts[0].thought).toBe('Let me think...');
    expect(assistantHistoryMsg.parts[1].text).toBe('I will call tools.');
    
    // Both function calls should have thoughtSignature as a sibling on the Part
    expect(assistantHistoryMsg.parts[2].thoughtSignature).toBe(thoughtSignature);
    expect(assistantHistoryMsg.parts[3].thoughtSignature).toBe(thoughtSignature);
  });
});
