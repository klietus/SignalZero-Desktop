import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callFastInference } from '../services/inferenceService.js';
import { settingsService } from '../services/settingsService.js';
import { urgentLlamaService, llamaService, LlamaPriority } from '../services/llamaService.js';

// Mock OpenAI
const mockOpenAICreate = vi.fn();
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockOpenAICreate
        }
      }
    }))
  };
});

// Mock Gemini
const mockGenerateContent = vi.fn();
vi.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: vi.fn().mockReturnValue({
        generateContent: mockGenerateContent
      })
    })),
    SchemaType: {}
  };
});

vi.mock('../services/settingsService.js', () => ({
  settingsService: {
    getInferenceSettings: vi.fn()
  }
}));

vi.mock('../services/llamaService.js', () => ({
  urgentLlamaService: {
    completion: vi.fn()
  },
  llamaService: {
    completion: vi.fn()
  },
  LlamaPriority: {
    LOW: 0,
    MEDIUM: 5,
    HIGH: 10,
    URGENT: 20
  }
}));

describe('callFastInference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use llama sidecar when priority is LOW', async () => {
    vi.mocked(settingsService.getInferenceSettings).mockResolvedValue({
      provider: 'openai',
      apiKey: 'test-key',
      agentModel: 'test-agent-model',
      model: 'test-model',
      endpoint: 'test-endpoint'
    } as any);

    vi.mocked(llamaService.completion).mockResolvedValue({ content: 'llama response' } as any);

    const result = await callFastInference([{ role: 'user', content: 'hello' }], 100, undefined, LlamaPriority.LOW);

    expect(result).toBe('llama response');
    expect(llamaService.completion).toHaveBeenCalled();
    expect(mockOpenAICreate).not.toHaveBeenCalled();
  });

  it('should use API when priority is HIGH and API is configured', async () => {
    vi.mocked(settingsService.getInferenceSettings).mockResolvedValue({
      provider: 'openai',
      apiKey: 'test-key',
      agentModel: 'test-agent-model',
      model: 'test-model',
      endpoint: 'test-endpoint'
    } as any);

    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: 'api response' } }]
    });

    const result = await callFastInference([{ role: 'user', content: 'hello' }], 100, undefined, LlamaPriority.HIGH);

    expect(result).toBe('api response');
    expect(mockOpenAICreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'test-agent-model'
    }));
    expect(urgentLlamaService.completion).not.toHaveBeenCalled();
  });

  it('should fallback to llama sidecar if API fails', async () => {
    vi.mocked(settingsService.getInferenceSettings).mockResolvedValue({
      provider: 'openai',
      apiKey: 'test-key',
      agentModel: 'test-agent-model',
      model: 'test-model',
      endpoint: 'test-endpoint'
    } as any);

    mockOpenAICreate.mockRejectedValue(new Error('API Error'));
    vi.mocked(urgentLlamaService.completion).mockResolvedValue({ content: 'fallback response' } as any);

    const result = await callFastInference([{ role: 'user', content: 'hello' }], 100, undefined, LlamaPriority.HIGH);

    expect(result).toBe('fallback response');
    expect(urgentLlamaService.completion).toHaveBeenCalled();
  });

  it('should use Gemini API when provider is gemini', async () => {
    vi.mocked(settingsService.getInferenceSettings).mockResolvedValue({
      provider: 'gemini',
      apiKey: 'test-key',
      agentModel: 'test-agent-model',
      model: 'test-model',
      endpoint: 'test-endpoint'
    } as any);

    mockGenerateContent.mockResolvedValue({
      response: { text: () => 'gemini response' }
    });

    const result = await callFastInference([{ role: 'user', content: 'hello' }], 100, undefined, LlamaPriority.HIGH);

    expect(result).toBe('gemini response');
    expect(mockGenerateContent).toHaveBeenCalled();
  });
});
