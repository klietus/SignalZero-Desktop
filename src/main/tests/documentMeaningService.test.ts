import { describe, it, expect, vi, beforeEach } from 'vitest';
import { documentMeaningService } from '../services/documentMeaningService.js';
import { settingsService } from '../services/settingsService.js';

// Mock dependencies
vi.mock('../services/settingsService.js', () => ({
  settingsService: {
    getInferenceSettings: vi.fn(),
  }
}));

vi.mock('../services/loggerService.js', () => ({
  loggerService: {
    info: vi.fn(),
    error: vi.fn(),
    catInfo: vi.fn(),
    catError: vi.fn(),
  }
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: vi.fn().mockImplementation(() => ({
      generateContent: vi.fn().mockResolvedValue({
        response: {
          text: () => 'Mocked Gemini description of the image.'
        }
      })
    }))
  }))
}));

vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'Mocked OpenAI description of the image.' } }]
          })
        }
      }
    }))
  };
});

describe('DocumentMeaningService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should detect and parse plain text', async () => {
    const result = await documentMeaningService.parse('Hello world', 'text/plain');
    expect(result.type).toBe('text');
    expect(result.content).toBe('Hello world');
  });

  it('should detect and parse JSON', async () => {
    const json = JSON.stringify({ key: 'value' });
    const result = await documentMeaningService.parse(json, 'application/json');
    expect(result.type).toBe('json');
    expect(JSON.parse(result.content)).toEqual({ key: 'value' });
  });

  it('should parse images using Gemini when configured', async () => {
    (settingsService.getInferenceSettings as any).mockResolvedValue({
      provider: 'gemini',
      apiKey: 'test-api-key',
      visionModel: 'gemini-1.5-flash'
    });

    const result = await documentMeaningService.parse(Buffer.from('fake-image-data'), 'image/jpeg');
    expect(result.type).toBe('image');
    expect(result.content).toBe('Mocked Gemini description of the image.');
  });

  it('should parse images using OpenAI when configured', async () => {
    (settingsService.getInferenceSettings as any).mockResolvedValue({
      provider: 'openai',
      apiKey: 'test-api-key',
      visionModel: 'gpt-4o-mini'
    });

    const result = await documentMeaningService.parse(Buffer.from('fake-image-data'), 'image/png');
    expect(result.type).toBe('image');
    expect(result.content).toBe('Mocked OpenAI description of the image.');
  });

  it('should handle missing API key for images', async () => {
    (settingsService.getInferenceSettings as any).mockResolvedValue({
      provider: 'gemini',
      apiKey: '',
      visionModel: 'gemini-1.5-flash'
    });

    const result = await documentMeaningService.parse(Buffer.from('fake-image-data'), 'image/jpeg');
    expect(result.type).toBe('image');
    expect(result.content).toContain('Missing API Key');
  });
});
