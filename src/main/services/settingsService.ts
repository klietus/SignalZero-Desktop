import { GraphHygieneSettings } from '../types.js';
import fs from 'fs';
import path from 'path';
import { app, safeStorage } from 'electron';
import { loggerService } from './loggerService.js';

// In Electron, settings are stored in the user data directory
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');

export interface McpConfiguration {
  id: string;
  name: string;
  endpoint: string;
  token?: string;
  enabled: boolean;
}

export interface InferenceSettings {
  provider: 'local' | 'openai' | 'gemini' | 'kimi2';
  apiKey: string;
  endpoint: string;
  model: string;
  agentModel: string;
  visionModel: string;
  fastModel: string;
  savedConfigs?: Record<string, InferenceConfiguration>;
}

export interface InferenceConfiguration {
  apiKey: string;
  endpoint: string;
  model: string;
  agentModel: string;
  visionModel: string;
  fastModel: string;
}

export interface SystemSettings {
  inference?: Partial<InferenceSettings>;
  serpApi?: {
    apiKey?: string;
  };
  hygiene?: GraphHygieneSettings;
  mcpConfigs?: McpConfiguration[];
}

let _settingsCache: SystemSettings | null = null;

// Helpers for encryption
const encrypt = (text: string): string => {
    if (!text) return '';
    if (!safeStorage.isEncryptionAvailable()) return Buffer.from(text).toString('hex');
    return safeStorage.encryptString(text).toString('hex');
};

const decrypt = (hex: string): string => {
    if (!hex) return '';
    try {
        const buffer = Buffer.from(hex, 'hex');
        if (!safeStorage.isEncryptionAvailable()) return buffer.toString('utf8');
        return safeStorage.decryptString(buffer);
    } catch (e) {
        return '';
    }
};

// Load settings from file
const loadFromFile = (): SystemSettings => {
  if (_settingsCache) return _settingsCache;

  if (!fs.existsSync(SETTINGS_FILE)) {
    return {};
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    _settingsCache = data as SystemSettings;
    return _settingsCache;
  } catch (e) {
    loggerService.error('Failed to load settings from file', { error: e });
    return {};
  }
};

// Save settings to file
const saveToFile = (settings: SystemSettings): void => {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    _settingsCache = settings;
  } catch (e) {
    loggerService.error('Failed to save settings to file', { error: e });
  }
};

export const settingsService = {
  initialize: async () => {
    loadFromFile();
  },

  isInitialized: (): boolean => {
    if (!fs.existsSync(SETTINGS_FILE)) return false;
    const settings = loadFromFile();
    return !!(settings.inference?.provider);
  },

  getApiKey: (): string => {
    return process.env.API_KEY || '';
  },

  setApiKey: (key: string) => {
    process.env.API_KEY = key;
  },

  getInferenceSettings: async (): Promise<InferenceSettings> => {
    const settings = loadFromFile();
    const saved = settings.inference || {};
    
    return {
      provider: (saved.provider as any) || 'local',
      apiKey: decrypt(saved.apiKey || ''),
      endpoint: saved.endpoint || 'http://localhost:1234/v1',
      model: saved.model || 'qwen3.5-122b-a10b',
      agentModel: saved.agentModel || saved.model || 'qwen3.5-122b-a10b',
      visionModel: saved.visionModel || 'zai-org/glm-4.6v-flash',
      fastModel: saved.fastModel || 'qwen3.5-0.8b',
      savedConfigs: saved.savedConfigs ? Object.fromEntries(
          Object.entries(saved.savedConfigs).map(([k, v]) => [k, { ...v, apiKey: decrypt(v.apiKey) }])
      ) : {},
    };
  },

  setInferenceSettings: async (settings: InferenceSettings) => {
    const current = loadFromFile();
    
    // Encrypt keys before saving
    const encryptedInference = {
        ...settings,
        apiKey: encrypt(settings.apiKey),
        savedConfigs: settings.savedConfigs ? Object.fromEntries(
            Object.entries(settings.savedConfigs).map(([k, v]) => [k, { ...v, apiKey: encrypt(v.apiKey) }])
        ) : {}
    };

    current.inference = encryptedInference;
    saveToFile(current);
  },

  getSerpApiSettings: async (): Promise<{ apiKey: string }> => {
    const settings = loadFromFile();
    return {
      apiKey: decrypt(settings.serpApi?.apiKey || ''),
    };
  },

  setSerpApiSettings: async (settings: { apiKey?: string }) => {
    const current = loadFromFile();
    current.serpApi = {
      apiKey: encrypt(settings.apiKey ?? ''),
    };
    saveToFile(current);
  },

  getHygieneSettings: async (): Promise<GraphHygieneSettings> => {
    const settings = loadFromFile();
    const saved = settings.hygiene || {} as any;
    
    return {
      positional: {
        autoCompress: saved.positional?.autoCompress === true,
        autoLink: saved.positional?.autoLink === true
      },
      semantic: {
        autoCompress: saved.semantic?.autoCompress === true,
        autoLink: saved.semantic?.autoLink === true
      },
      triadic: {
        autoCompress: saved.triadic?.autoCompress === true,
        autoLink: saved.triadic?.autoLink === true
      },
      deadLinkCleanup: saved.deadLinkCleanup === true,
      orphanAnalysis: saved.orphanAnalysis === true
    };
  },

  setHygieneSettings: async (settings: GraphHygieneSettings) => {
    const current = loadFromFile();
    current.hygiene = settings;
    saveToFile(current);
  },

  getMcpConfigs: async (): Promise<McpConfiguration[]> => {
    const settings = loadFromFile();
    return settings.mcpConfigs || [];
  },

  setMcpConfigs: async (configs: McpConfiguration[]) => {
    const current = loadFromFile();
    current.mcpConfigs = configs;
    saveToFile(current);
  },

  get: async (): Promise<SystemSettings> => {
    const settings = loadFromFile();
    // Return decrypted view for UI/Runtime use
    const inference = await settingsService.getInferenceSettings();
    const serpApi = await settingsService.getSerpApiSettings();
    return {
        ...settings,
        inference,
        serpApi
    };
  },

  update: async (settings: Partial<SystemSettings>) => {
    const current = loadFromFile();
    
    if (settings.inference) {
        current.inference = {
            ...current.inference,
            ...settings.inference,
            apiKey: encrypt(settings.inference.apiKey || '')
        };
    }
    
    if (settings.serpApi) {
        current.serpApi = {
            ...current.serpApi,
            ...settings.serpApi,
            apiKey: encrypt(settings.serpApi.apiKey || '')
        };
    }
    
    const otherSettings = { ...settings };
    delete otherSettings.inference;
    delete otherSettings.serpApi;

    saveToFile({ ...current, ...otherSettings });
  }
};
