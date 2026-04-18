import { GraphHygieneSettings, MonitoringSourceConfig } from '../types.js';
import fs from 'fs';
import path from 'path';
import { app, safeStorage } from 'electron';
import { loggerService, LogCategory } from './loggerService.js';

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
  voiceEnabled?: boolean;
  systemName?: string;
  voiceId?: string;
  voiceProfiles?: Record<string, number[]>;
  dominantLanguage?: string;
  savedConfigs?: Record<string, InferenceConfiguration>;
}

export interface InferenceConfiguration {
  apiKey: string;
  endpoint: string;
  model: string;
  agentModel: string;
  visionModel: string;
  fastModel: string;
  voiceEnabled?: boolean;
  systemName?: string;
  voiceId?: string;
  dominantLanguage?: string;
}

export interface WebSearchProviderSettings {
  apiKey?: string;
  enabled: boolean;
}

export interface MonitoringSettings {
  enabled: boolean;
  sources: MonitoringSourceConfig[];
}

export interface SystemSettings {
  inference?: Partial<InferenceSettings>;
  voiceProfiles?: Record<string, number[]>; 
  systemName?: string; 
  voiceId?: string;
  voiceEnabled?: boolean;
  dominantLanguage?: string;
  serpApi?: WebSearchProviderSettings;
  braveSearch?: WebSearchProviderSettings;
  tavily?: WebSearchProviderSettings;
  hygiene?: GraphHygieneSettings;
  mcpConfigs?: McpConfiguration[];
  monitoring?: MonitoringSettings;
  ui?: {
    showGraphviz?: boolean;
  };
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
      voiceEnabled: settings.voiceEnabled ?? saved.voiceEnabled ?? false,
      systemName: settings.systemName ?? saved.systemName ?? 'axiom',
      voiceId: settings.voiceId ?? saved.voiceId ?? 'af_sarah',
      voiceProfiles: settings.voiceProfiles || (saved as any).voiceProfiles || {},
      dominantLanguage: settings.dominantLanguage ?? saved.dominantLanguage ?? 'en',
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

  getSerpApiSettings: async (): Promise<WebSearchProviderSettings> => {
    const settings = loadFromFile();
    return {
      apiKey: decrypt(settings.serpApi?.apiKey || ''),
      enabled: settings.serpApi?.enabled ?? false,
    };
  },

  setSerpApiSettings: async (settings: WebSearchProviderSettings) => {
    const current = loadFromFile();
    current.serpApi = {
      apiKey: encrypt(settings.apiKey ?? ''),
      enabled: settings.enabled,
    };
    saveToFile(current);
  },

  getBraveSearchSettings: async (): Promise<WebSearchProviderSettings> => {
    const settings = loadFromFile();
    return {
      apiKey: decrypt(settings.braveSearch?.apiKey || ''),
      enabled: settings.braveSearch?.enabled ?? false,
    };
  },

  setBraveSearchSettings: async (settings: WebSearchProviderSettings) => {
    const current = loadFromFile();
    current.braveSearch = {
      apiKey: encrypt(settings.apiKey ?? ''),
      enabled: settings.enabled,
    };
    saveToFile(current);
  },

  getTavilySettings: async (): Promise<WebSearchProviderSettings> => {
    const settings = loadFromFile();
    return {
      apiKey: decrypt(settings.tavily?.apiKey || ''),
      enabled: settings.tavily?.enabled ?? false,
    };
  },

  setTavilySettings: async (settings: WebSearchProviderSettings) => {
    const current = loadFromFile();
    current.tavily = {
      apiKey: encrypt(settings.apiKey ?? ''),
      enabled: settings.enabled,
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
      refactorLinks: saved.refactorLinks === true,
      reflexiveLinks: saved.reflexiveLinks === true,
      bridgeIslands: saved.bridgeIslands === true,
      domainRefactor: saved.domainRefactor === true,
      bridgeLifting: saved.bridgeLifting === true,
      linkPromotion: saved.linkPromotion === true
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

  getMonitoringSettings: async (): Promise<MonitoringSettings> => {
    const settings = loadFromFile();
    return settings.monitoring || { enabled: false, sources: [] };
  },

  setMonitoringSettings: async (monitoring: MonitoringSettings) => {
    const current = loadFromFile();
    current.monitoring = monitoring;
    saveToFile(current);
  },

  get: async (): Promise<SystemSettings> => {
    const settings = loadFromFile();
    // Return decrypted view for UI/Runtime use
    const inference = await settingsService.getInferenceSettings();
    const serpApi = await settingsService.getSerpApiSettings();
    const braveSearch = await settingsService.getBraveSearchSettings();
    const tavily = await settingsService.getTavilySettings();
    const monitoring = await settingsService.getMonitoringSettings();
    return {
        ...settings,
        inference,
        serpApi,
        braveSearch,
        tavily,
        monitoring,
        voiceProfiles: settings.voiceProfiles || inference.voiceProfiles,
        systemName: settings.systemName || inference.systemName,
        voiceId: settings.voiceId || inference.voiceId,
        voiceEnabled: settings.voiceEnabled ?? inference.voiceEnabled,
        dominantLanguage: settings.dominantLanguage || inference.dominantLanguage
    };
  },

  update: async (settings: Partial<SystemSettings>) => {
    loggerService.catInfo(LogCategory.SYSTEM, "Settings update call received.");
    const current = loadFromFile();
    
    // Handle global voice settings - Use replacement to allow deletions
    if (settings.voiceProfiles) {
        current.voiceProfiles = settings.voiceProfiles;
        loggerService.catInfo(LogCategory.SYSTEM, `Updated voice profiles. Total: ${Object.keys(current.voiceProfiles).length}`);
    }
    if (settings.systemName) current.systemName = settings.systemName;
    if (settings.voiceId) current.voiceId = settings.voiceId;
    if (settings.voiceEnabled !== undefined) current.voiceEnabled = settings.voiceEnabled;
    if (settings.dominantLanguage) current.dominantLanguage = settings.dominantLanguage;

    if (settings.inference) {
        const currentSavedConfigs = current.inference?.savedConfigs || {};
        const incomingSavedConfigs = settings.inference.savedConfigs || {};
        
        // Merge saved configs and encrypt apiKeys
        const mergedSavedConfigs = { ...currentSavedConfigs };
        for (const [key, value] of Object.entries(incomingSavedConfigs)) {
            mergedSavedConfigs[key] = {
                ...value,
                apiKey: encrypt(value.apiKey || '')
            };
        }

        // Clean up incoming inference from local voice settings that are now global
        const { 
            voiceProfiles: _vp, 
            systemName: _sn, 
            voiceId: _vid, 
            voiceEnabled: _ve, 
            dominantLanguage: _dl, 
            ...cleanInference 
        } = settings.inference as any;

        // Ensure we also remove these from current.inference if they exist
        const updatedInference = {
            ...current.inference,
            ...cleanInference,
            apiKey: encrypt(settings.inference.apiKey || ''),
            savedConfigs: mergedSavedConfigs
        };
        
        // Surgical removal of legacy fields from the inference object
        delete (updatedInference as any).voiceProfiles;
        delete (updatedInference as any).systemName;
        delete (updatedInference as any).voiceId;
        delete (updatedInference as any).voiceEnabled;
        delete (updatedInference as any).dominantLanguage;

        current.inference = updatedInference;
    }
    
    if (settings.serpApi) {
        current.serpApi = {
            ...current.serpApi,
            ...settings.serpApi,
            apiKey: encrypt(settings.serpApi.apiKey || '')
        };
    }

    if (settings.braveSearch) {
        current.braveSearch = {
            ...current.braveSearch,
            ...settings.braveSearch,
            apiKey: encrypt(settings.braveSearch.apiKey || '')
        };
    }

    if (settings.tavily) {
        current.tavily = {
            ...current.tavily,
            ...settings.tavily,
            apiKey: encrypt(settings.tavily.apiKey || '')
        };
    }

    if (settings.monitoring) {
        current.monitoring = {
            ...current.monitoring,
            ...settings.monitoring
        };
    }
    
    const otherSettings = { ...settings };
    delete otherSettings.inference;
    delete otherSettings.serpApi;
    delete otherSettings.braveSearch;
    delete otherSettings.tavily;
    delete otherSettings.monitoring;
    delete (otherSettings as any).voiceProfiles;
    delete (otherSettings as any).systemName;
    delete (otherSettings as any).voiceId;
    delete (otherSettings as any).voiceEnabled;
    delete (otherSettings as any).dominantLanguage;

    saveToFile({ ...current, ...otherSettings });
  }
};

