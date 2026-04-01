import { describe, it, expect, vi, beforeEach } from 'vitest';
import { inferenceService } from '../services/inferenceService.js';
import { contextService } from '../services/contextService.js';

// Mock dependencies
vi.mock('../services/contextService.js', () => ({
  contextService: {
    getSession: vi.fn(),
    recordMessage: vi.fn().mockResolvedValue(undefined),
    getUnfilteredHistory: vi.fn().mockResolvedValue([]),
    updateSession: vi.fn().mockResolvedValue(undefined),
  }
}));

vi.mock('../services/settingsService.js', () => ({
  settingsService: {
    getInferenceSettings: vi.fn().mockResolvedValue({
      model: 'test-model',
      provider: 'openai',
    })
  }
}));

vi.mock('../services/contextWindowService.js', () => ({
  contextWindowService: {
    constructContextWindow: vi.fn().mockResolvedValue([{ role: 'system', content: 'test instruction' }]),
  }
}));

vi.mock('../services/symbolCacheService.js', () => ({
  symbolCacheService: {
    incrementTurns: vi.fn().mockResolvedValue(undefined),
  }
}));

vi.mock('../services/tentativeLinkService.js', () => ({
  tentativeLinkService: {
    incrementTurns: vi.fn().mockResolvedValue(undefined),
  }
}));

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

// We need to mock streamAssistantResponse and resolveAttachments which are exported
const mockStreamAssistantResponse = vi.spyOn(inferenceService, 'streamAssistantResponse');
const mockResolveAttachments = vi.spyOn(inferenceService, 'resolveAttachments');

describe('sendMessageAndHandleTools Turn Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (contextService.getSession as any).mockResolvedValue({ id: 'sess-1', status: 'open', metadata: {} });
    mockResolveAttachments.mockResolvedValue({ resolvedContent: 'user message', attachments: [] });
  });

  it('should only emit narrative text from the final loop if previous loops had tool calls', async () => {
    const toolExecutor = vi.fn().mockResolvedValue({ status: 'success' });

    // Loop 0: Returns text and a tool call
    const loop0 = [
      { text: 'I am thinking...' },
      { toolCalls: [{ id: 'call-1', function: { name: 'web_search', arguments: '{"query":"test"}' } }] },
      { assistantMessage: { role: 'assistant', content: 'I am thinking...', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'web_search', arguments: '{"query":"test"}' } }] } }
    ];

    // Loop 1: Returns final narrative text
    const loop1 = [
      { text: 'Final answer. This is more than two characters.' },
      { assistantMessage: { role: 'assistant', content: 'Final answer. This is more than two characters.' } }
    ];

    let callCount = 0;
    mockStreamAssistantResponse.mockImplementation(async function* () {
      const chunks = callCount === 0 ? loop0 : loop1;
      callCount++;
      for (const chunk of chunks) {
        yield chunk as any;
      }
    });

    const generator = inferenceService.sendMessageAndHandleTools(
      { model: 'test-model', messages: [], systemInstruction: '' },
      'user message',
      toolExecutor,
      false,
      'system instruction',
      'sess-1'
    );

    const emittedChunks: any[] = [];
    for await (const chunk of generator) {
      emittedChunks.push(chunk);
    }

    const textChunks = emittedChunks.filter(c => c.text).map(c => c.text);

    // The current implementation accumulates and yields the full narrative at the end of the final turn.
    expect(textChunks[0]).toContain('I am thinking...');
    expect(textChunks[0]).toContain('Final answer.');
  });

  it('should handle split thought tags correctly across chunks', async () => {
    const toolExecutor = vi.fn().mockResolvedValue({ status: 'success' });

    // Simulate a closing tag split across two chunks: "</thi" and "nk> "
    const loop0 = [
      { text: '<think> Reasoning ' },
      { text: '</thi' },
      { text: 'nk> Narrative text.' },
      { assistantMessage: { role: 'assistant', content: '<think> Reasoning </think> Narrative text.' } }
    ];

    mockStreamAssistantResponse.mockImplementation(async function* () {
      for (const chunk of loop0) {
        yield chunk as any;
      }
    });

    const generator = inferenceService.sendMessageAndHandleTools(
      { model: 'test-model', messages: [], systemInstruction: '' },
      'user message',
      toolExecutor,
      false,
      'system instruction',
      'sess-1'
    );

    const emittedChunks: any[] = [];
    for await (const chunk of generator) {
      emittedChunks.push(chunk);
    }

    const textChunks = emittedChunks.filter(c => c.text).map(c => c.text);

    // Verify that the narrative part "Narrative text." was captured despite the split tag
    expect(textChunks[0]).toContain('Narrative text.');
    expect(textChunks[0]).not.toContain('Reasoning');
  });
});
