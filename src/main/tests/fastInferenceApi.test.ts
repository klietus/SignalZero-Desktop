import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callFastInference } from '../services/inferenceService.js';
import { settingsService } from '../services/settingsService.js';
import OpenAI from 'openai';

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

vi.mock('../services/settingsService.js', () => ({
  settingsService: {
    getInferenceSettings: vi.fn()
  }
}));

describe('callFastInference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use API when configured with fastInferenceModel', async () => {
    vi.mocked(settingsService.getInferenceSettings).mockResolvedValue({
      provider: 'openai',
      apiKey: 'test-key',
      fastInferenceModel: 'fast-model',
      agentModel: 'test-agent-model',
      model: 'test-model',
      endpoint: 'test-endpoint'
    } as any);

    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: 'api response' } }]
    });

    const result = await callFastInference([{ role: 'user', content: 'hello' }], 100);

    expect(result).toBe('api response');
    expect(mockOpenAICreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'fast-model'
    }));
  });

  it('should use agentModel when fastInferenceModel is not configured', async () => {
    vi.mocked(settingsService.getInferenceSettings).mockResolvedValue({
      provider: 'openai',
      apiKey: 'test-key',
      agentModel: 'agent-model',
      model: 'test-model',
      endpoint: 'test-endpoint'
    } as any);

    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: 'api response' } }]
    });

    const result = await callFastInference([{ role: 'user', content: 'hello' }], 100);

    expect(result).toBe('api response');
    expect(mockOpenAICreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'agent-model'
    }));
  });

  it('should throw error when API is not configured', async () => {
    vi.mocked(settingsService.getInferenceSettings).mockResolvedValue({
      provider: 'local',
      apiKey: '',
      model: 'test-model',
      endpoint: ''
    } as any);

    await expect(callFastInference([{ role: 'user', content: 'hello' }], 100))
      .rejects.toThrow('Fast inference requires a configured API endpoint');
  });

  it('should throw error when API call fails', async () => {
    vi.mocked(settingsService.getInferenceSettings).mockResolvedValue({
      provider: 'openai',
      apiKey: 'test-key',
      fastInferenceModel: 'fast-model',
      agentModel: 'test-agent-model',
      model: 'test-model',
      endpoint: 'test-endpoint'
    } as any);

    mockOpenAICreate.mockRejectedValue(new Error('API Error'));

    await expect(callFastInference([{ role: 'user', content: 'hello' }], 100))
      .rejects.toThrow('Fast inference API error');
  });

  it('should use custom endpoint when provider is not openai/kimi2/gemini', async () => {
    vi.mocked(settingsService.getInferenceSettings).mockResolvedValue({
      provider: 'custom',
      apiKey: 'test-key',
      fastInferenceModel: 'local-model',
      model: 'test-model',
      endpoint: 'http://localhost:1234/v1'
    } as any);

    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: 'custom api response' } }]
    });

    const result = await callFastInference([{ role: 'user', content: 'hello' }], 100);

    expect(result).toBe('custom api response');
    expect(mockOpenAICreate).toHaveBeenCalled();
  });
});
