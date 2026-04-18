import React, { useState, useEffect, useRef } from 'react';
import { 
    Save, Database, Network, Cpu, Cloud, 
    Search, AlertCircle, Layout, RefreshCw, Plus,
    Trash2, CheckCircle2, XCircle, Server, Activity, Play,
    Volume2, Mic
} from 'lucide-react';
import { UserProfile, GraphHygieneSettings, McpConfiguration } from '../../types';
import { Header, HeaderProps } from '../Header';

interface SettingsScreenProps {
    headerProps: Omit<HeaderProps, 'children'>;
    user: UserProfile | null;
    onLogout: () => void;
    initialTab?: string;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
    headerProps,
    initialTab = 'inference'
}) => {
  const [activeTab, setActiveTab] = useState(initialTab);
  
  // Web Search State
  const [serpApiKey, setSerpApiKey] = useState('');
  const [serpApiEnabled, setSerpApiEnabled] = useState(false);
  const [braveApiKey, setBraveApiKey] = useState('');
  const [braveEnabled, setBraveEnabled] = useState(false);
  const [tavilyApiKey, setTavilyApiKey] = useState('');
  const [tavilyEnabled, setTavilyEnabled] = useState(false);

  // Inference State
  const [inferenceProvider, setInferenceProvider] = useState<'local' | 'openai' | 'gemini' | 'kimi2'>('local');
  const [inferenceApiKey, setInferenceApiKey] = useState('');
  const [inferenceEndpoint, setInferenceEndpoint] = useState('');
  const [inferenceModel, setInferenceModel] = useState('');
  const [inferenceAgentModel, setInferenceAgentModel] = useState('');
  const [inferenceVisionModel, setInferenceVisionModel] = useState('');
  const [inferenceFastModel, setInferenceFastModel] = useState('');
  
  // Voice State
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [systemName, setSystemName] = useState('Signal');
  const [voiceId, setVoiceId] = useState('af_sarah');
  const [dominantLanguage, setDominantLanguage] = useState('en');
  const [profileName, setProfileName] = useState('');
  const profileNameRef = useRef('');
  
  useEffect(() => {
    profileNameRef.current = profileName;
  }, [profileName]);

  const [voiceProfile, setVoiceProfile] = useState<number[] | undefined>(undefined);
  const [voiceProfiles, setVoiceProfiles] = useState<Record<string, number[]>>({});
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [isAiEnrolling, setIsAiEnrolling] = useState(false);
  const [enrollmentProgress, setEnrollmentProgress] = useState(0);
  const [isEnrollmentComplete, setIsEnrollmentComplete] = useState(false);

  const handleDeleteProfile = async (name: string) => {
      try {
          const currentSettings = await window.api.getSettings();
          const updatedProfiles = { ...(currentSettings.voiceProfiles || {}) };
          delete updatedProfiles[name];
          
          await window.api.updateSettings({
              ...currentSettings,
              voiceProfiles: updatedProfiles
          });
          setVoiceProfiles(updatedProfiles);
      } catch (err) {
          console.error("Failed to delete voice profile", err);
      }
  };

  const ENROLLMENT_PHRASES = [
      "Axiom, initialize secure symbolic protocol.",
      "Identify primary user and verify voice fingerprint.",
      "The symbolic kernel is operational and invariants are holding.",
      "Accessing distributed knowledge domains for deep analysis.",
      "Axiom, system status report and diagnostic check."
  ];

  // Graph Hygiene State
  const [hygieneSettings, setHygieneSettings] = useState<GraphHygieneSettings>({
    positional: { autoCompress: false, autoLink: false },
    semantic: { autoCompress: false, autoLink: false },
    triadic: { autoCompress: false, autoLink: false },
    deadLinkCleanup: false,
    refactorLinks: false,
    reflexiveLinks: false,
    bridgeIslands: false,
    domainRefactor: false,
    bridgeLifting: false,
    linkPromotion: false
  });

  // UI Settings
  const [showGraphviz, setShowGraphviz] = useState(true);

  const [isRunningHygiene, setIsRunningHygiene] = useState<string | null>(null);

  // MCP State
  const [mcpConfigs, setMcpConfigs] = useState<McpConfiguration[]>([]);
  const [storedConfigs, setStoredConfigs] = useState<Record<string, any>>({});

  // Monitoring State
  const [monitoringEnabled, setMonitoringEnabled] = useState(false);
  const [monitoringSources, setMonitoringSources] = useState<any[]>([]);
  
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New MCP Modal State
  const [isMcpModalOpen, setIsMcpModalOpen] = useState(false);
  const [newMcpName, setNewMcpName] = useState('');
  const [newMcpEndpoint, setNewMcpEndpoint] = useState('');
  const [newMcpToken, setNewMcpToken] = useState('');
  const [isValidatingMcp, setIsValidatingMcp] = useState(false);
  const [validationResult, setValidationResult] = useState<{ success?: boolean, toolCount?: number, error?: string } | null>(null);

  const handleValidateMcp = async () => {
      if (!newMcpEndpoint) return;
      setIsValidatingMcp(true);
      setValidationResult(null);
      try {
          const res = await window.api.validateMcp(newMcpEndpoint, newMcpToken);
          setValidationResult(res);
      } catch (err: any) {
          setValidationResult({ success: false, error: err.message });
      } finally {
          setIsValidatingMcp(false);
      }
  };

  const handleAddMcp = () => {
      const id = newMcpName.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const newConfig: McpConfiguration = {
          id,
          name: newMcpName,
          endpoint: newMcpEndpoint,
          token: newMcpToken,
          enabled: true
      };
      setMcpConfigs(prev => [...prev, newConfig]);
      setIsMcpModalOpen(false);
      setNewMcpName('');
      setNewMcpEndpoint('');
      setNewMcpToken('');
      setValidationResult(null);
  };

  const handleRemoveMcp = (id: string) => {
      setMcpConfigs(prev => prev.filter(c => c.id !== id));
  };

  const hydrateSettings = (settings: any) => {
    const inference = settings.inference || {};
    const serpApi = settings.serpApi || {};
    const braveSearch = settings.braveSearch || {};
    const tavily = settings.tavily || {};
    const hygiene = settings.hygiene || {
        positional: { autoCompress: false, autoLink: false },
        semantic: { autoCompress: false, autoLink: false },
        triadic: { autoCompress: false, autoLink: false },
        deadLinkCleanup: false,
        refactorLinks: false,
        reflexiveLinks: false,
        bridgeIslands: false,
        domainRefactor: false,
        bridgeLifting: false,
        linkPromotion: false
    };

    setSerpApiKey(serpApi.apiKey || '');
    setSerpApiEnabled(serpApi.enabled ?? false);
    setBraveApiKey(braveSearch.apiKey || '');
    setBraveEnabled(braveSearch.enabled ?? false);
    setTavilyApiKey(tavily.apiKey || '');
    setTavilyEnabled(tavily.enabled ?? false);

    setMcpConfigs(settings.mcpConfigs || []);
    setMonitoringEnabled(settings.monitoring?.enabled ?? false);
    setMonitoringSources(settings.monitoring?.sources || []);

    setShowGraphviz(settings.ui?.showGraphviz ?? true);

    const provider = inference.provider || 'local';
    setInferenceProvider(provider);
    setInferenceApiKey(inference.apiKey || '');
    setInferenceEndpoint(inference.endpoint || '');
    setInferenceModel(inference.model || '');
    setInferenceAgentModel(inference.agentModel || inference.model || '');
    setInferenceVisionModel(inference.visionModel || '');
    setInferenceFastModel(inference.fastModel || '');
    
    // Voice settings are now top-level in settings object, but with fallbacks
    setVoiceEnabled(settings.voiceEnabled ?? inference.voiceEnabled ?? false);
    setSystemName(settings.systemName || inference.systemName || 'axiom');
    setProfileName(''); // Reset enrollment name
    setVoiceId(settings.voiceId || inference.voiceId || 'af_sarah');
    setVoiceProfiles(settings.voiceProfiles || inference.voiceProfiles || {});
    setDominantLanguage(settings.dominantLanguage || inference.dominantLanguage || 'en');
    
    setHygieneSettings(hygiene);
    if (inference.savedConfigs) setStoredConfigs(inference.savedConfigs);
  };

  useEffect(() => {
      const loadSettings = async () => {
        setIsLoading(true);
        try {
            const settings = await window.api.getSettings();
            hydrateSettings(settings);
        } catch (err) {
            setError('Failed to load settings.');
        } finally {
            setIsLoading(false);
        }
      };
      loadSettings();
  }, []);

  useEffect(() => {
    const unbindProgress = window.api.onVoiceEnrollProgress?.((data: { count: number, verified: boolean, text: string }) => {
        if (data.verified) {
            setEnrollmentProgress(data.count);
            
            // Auto-advance logic
            if (data.count < ENROLLMENT_PHRASES.length) {
                // Short delay before showing next phrase
                setTimeout(() => {
                    window.api.nextVoiceEnrollmentPhrase(ENROLLMENT_PHRASES[data.count]);
                }, 1500);
            } else {
                // Automatically stop when all phrases are done
                setTimeout(() => {
                    window.api.stopVoiceEnrollment(profileNameRef.current);
                }, 1000);
            }
        } else {
            console.log(`[Enrollment] Phrase not verified. Heard: "${data.text}", Expected: "${ENROLLMENT_PHRASES[enrollmentProgress]}"`);
        }
    }) || (() => {});

    const unbindFinalized = window.api.onVoiceEnrollFinalized?.(async (data: { profile: number[], name: string }) => {
        setVoiceProfile(data.profile);
        setIsEnrolling(false);
        setIsEnrollmentComplete(true);
        setEnrollmentProgress(0);
        
        const finalName = data.name || profileNameRef.current;
        
        // Save automatically
        try {
            const currentSettings = await window.api.getSettings();
            const updatedProfiles = { 
                ...(currentSettings.voiceProfiles || {}),
                [finalName]: data.profile 
            };
            
            setVoiceProfiles(updatedProfiles);

            await window.api.updateSettings({
                ...currentSettings,
                voiceProfiles: updatedProfiles
            });
            console.log(`[Enrollment] Voice profile for '${finalName}' saved to global settings.`);
        } catch (e) {
            console.error("Failed to auto-save voice profile", e);
        }
    }) || (() => {});

    return () => {
        unbindProgress();
        unbindFinalized();
    };
  }, []);

  const handleProviderChange = (newProvider: 'local' | 'openai' | 'gemini' | 'kimi2') => {
      const currentConfig = {
          apiKey: inferenceApiKey,
          endpoint: inferenceEndpoint,
          model: inferenceModel,
          agentModel: inferenceAgentModel,
          visionModel: inferenceVisionModel,
          fastModel: inferenceFastModel
      };
      const updatedConfigs = { ...storedConfigs, [inferenceProvider]: currentConfig };
      setStoredConfigs(updatedConfigs);
      setInferenceProvider(newProvider);

      const saved = updatedConfigs[newProvider];
      if (saved) {
          setInferenceApiKey(saved.apiKey || '');
          setInferenceEndpoint(saved.endpoint || '');
          setInferenceModel(saved.model || '');
          setInferenceAgentModel(saved.agentModel || '');
          setInferenceVisionModel(saved.visionModel || '');
          setInferenceFastModel(saved.fastModel || '');
      } else {
          setInferenceApiKey('');
          if (newProvider === 'openai') {
              setInferenceEndpoint('https://api.openai.com/v1');
              setInferenceModel('gpt-4o');
              setInferenceAgentModel('gpt-4o');
              setInferenceVisionModel('gpt-4o');
              setInferenceFastModel('gpt-4o-mini');
          } else if (newProvider === 'gemini') {
              setInferenceEndpoint('');
              setInferenceModel('gemini-2.5-pro');
              setInferenceAgentModel('gemini-2.5-pro');
              setInferenceVisionModel('gemini-2.5-pro');
              setInferenceFastModel('gemini-2.5-flash');
          } else if (newProvider === 'kimi2') {
              setInferenceEndpoint('https://api.moonshot.cn/v1');
              setInferenceModel('moonshot-v1-8k');
              setInferenceAgentModel('moonshot-v1-8k');
              setInferenceVisionModel('moonshot-v1-8k');
              setInferenceFastModel('moonshot-v1-8k');
          } else {
              setInferenceEndpoint('http://127.0.0.1:1234/v1');
              setInferenceModel('');
              setInferenceAgentModel('');
              setInferenceVisionModel('');
              setInferenceFastModel('');
          }
      }
  };

  const handleSave = async () => {
    setIsSaving(true);
    console.log("[SettingsScreen] Starting save. Current voiceProfiles count:", Object.keys(voiceProfiles).length);
    try {
        const currentSettings = await window.api.getSettings();
        
        const currentInferenceConfig = {
          apiKey: inferenceApiKey,
          endpoint: inferenceEndpoint,
          model: inferenceModel,
          agentModel: inferenceAgentModel,
          visionModel: inferenceVisionModel,
          fastModel: inferenceFastModel
        };
        const finalConfigs = { ...storedConfigs, [inferenceProvider]: currentInferenceConfig };

        console.log("[SettingsScreen] Sending updateSettings IPC...");
        
        await window.api.updateSettings({
            ...currentSettings, // PRESERVE ALL OTHER SETTINGS
            ui: { ...currentSettings.ui, showGraphviz },
            serpApi: { apiKey: serpApiKey, enabled: serpApiEnabled },
            braveSearch: { apiKey: braveApiKey, enabled: braveEnabled },
            tavily: { apiKey: tavilyApiKey, enabled: tavilyEnabled },
            hygiene: hygieneSettings,
            // Voice settings are now top-level
            voiceEnabled,
            systemName,
            voiceId,
            voiceProfiles,
            dominantLanguage,
            inference: {
                ...currentSettings.inference,
                provider: inferenceProvider,
                apiKey: inferenceApiKey,
                endpoint: inferenceEndpoint,
                model: inferenceModel,
                agentModel: inferenceAgentModel,
                visionModel: inferenceVisionModel,
                fastModel: inferenceFastModel,
                savedConfigs: finalConfigs
            },
            mcpConfigs,
            monitoring: {
                enabled: monitoringEnabled,
                sources: monitoringSources
            }
        });
        alert('Settings saved!');
    } catch (err) {
        setError('Failed to save settings.');
    } finally {
        setIsSaving(false);
    }
  };

  const handleRunHygiene = async (strategy: string) => {
    setIsRunningHygiene(strategy);
    try {
        const stats = await window.api.runHygiene(strategy);
        alert(`Hygiene run complete: ${JSON.stringify(stats)}`);
    } catch (err: any) {
        alert(`Error running hygiene: ${err.message}`);
    } finally {
        setIsRunningHygiene(null);
    }
  };

  const handlePollSource = async (sourceId: string) => {
    try {
        await window.api.pollSource(sourceId);
        alert('Poll triggered! Check logs for progress.');
    } catch (err: any) {
        alert(`Failed to trigger poll: ${err.message}`);
    }
  };

  const tabs = [
      { id: 'appearance', label: 'Appearance', icon: Layout },
      { id: 'inference', label: 'Inference', icon: Cpu },
      { id: 'voice', label: 'Voice & Edge', icon: Volume2 },
      { id: 'services', label: 'Services', icon: Cloud },
      { id: 'monitoring', label: 'World Monitoring', icon: Activity },
      { id: 'mcp', label: 'MCP Clients', icon: Network },
      { id: 'hygiene', label: 'Graph Hygiene', icon: Database },
  ];

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950 font-sans text-gray-900 dark:text-gray-100">
      <Header {...headerProps} title="Settings" subtitle="Local System Configuration">
          <button onClick={handleSave} disabled={isSaving || isLoading} className="flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-bold font-mono transition-colors text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50">
              <Save size={16} /> {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
      </Header>

      <div className="flex flex-1 overflow-hidden">
          <aside className="w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col">
              <div className="p-4 space-y-1">
                  {tabs.map(tab => (
                      <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${activeTab === tab.id ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                          <tab.icon size={18} /> {tab.label}
                      </button>
                  ))}
              </div>
          </aside>

          <main className="flex-1 overflow-y-auto p-8">
              <div className="max-w-3xl mx-auto space-y-8">
                  {error && <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm font-mono flex items-center gap-3"><AlertCircle size={18} /> {error}</div>}

                  {activeTab === 'inference' && (
                      <section className="space-y-6">
                          <div className="bg-white dark:bg-gray-900 p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-6">
                              <div className="grid grid-cols-4 gap-3 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
                                  {['local', 'openai', 'gemini', 'kimi2'].map(p => (
                                      <button key={p} onClick={() => handleProviderChange(p as any)} className={`py-2 rounded-md text-sm font-bold font-mono transition-all ${inferenceProvider === p ? 'bg-white dark:bg-gray-700 text-indigo-600 shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>
                                          {p.toUpperCase()}
                                      </button>
                                  ))}
                              </div>
                              <div className="space-y-4">
                                  {inferenceProvider !== 'local' && (
                                      <div className="space-y-2">
                                          <label className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono">API Key</label>
                                          <input type="password" value={inferenceApiKey} onChange={(e) => setInferenceApiKey(e.target.value)} className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-2 text-sm font-mono" />
                                      </div>
                                  )}
                                  {inferenceProvider === 'local' && (
                                      <div className="space-y-2">
                                          <label className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono">Endpoint</label>
                                          <input type="text" value={inferenceEndpoint} onChange={(e) => setInferenceEndpoint(e.target.value)} className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-2 text-sm font-mono" />
                                      </div>
                                  )}
                                  <div className="grid grid-cols-2 gap-4">
                                      <div className="space-y-2">
                                          <label className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono">Chat Model</label>
                                          <input type="text" value={inferenceModel} onChange={(e) => setInferenceModel(e.target.value)} className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-2 text-sm font-mono" />
                                      </div>
                                      <div className="space-y-2">
                                          <label className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono">Agent Model</label>
                                          <input type="text" value={inferenceAgentModel} onChange={(e) => setInferenceAgentModel(e.target.value)} className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-2 text-sm font-mono" />
                                      </div>
                                      <div className="space-y-2">
                                          <label className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono">Fast Model</label>
                                          <input type="text" value={inferenceFastModel} onChange={(e) => setInferenceFastModel(e.target.value)} className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-2 text-sm font-mono" />
                                      </div>
                                      <div className="space-y-2">
                                          <label className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono">Vision Model</label>
                                          <input type="text" value={inferenceVisionModel} onChange={(e) => setInferenceVisionModel(e.target.value)} className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-2 text-sm font-mono" />
                                      </div>
                                  </div>
                              </div>
                          </div>
                      </section>
                  )}

                  {activeTab === 'voice' && (
                      <section className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                          <div className="bg-white dark:bg-gray-900 p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-8">
                              <div className="space-y-6">
                                  <div className="flex items-center justify-between border-b pb-2">
                                      <div className="flex items-center gap-2 font-bold"><Volume2 size={16} className="text-indigo-500" /> Voice & Edge Configuration</div>
                                  </div>

                                  <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-800">
                                      <div className="flex items-center justify-between">
                                          <div className="space-y-1">
                                              <div className="font-bold text-sm">Enable Voice Mode</div>
                                              <p className="text-xs text-gray-500">Allow system-wide voice interaction and TTS feedback.</p>
                                          </div>
                                          <label className="relative inline-flex items-center cursor-pointer">
                                              <input type="checkbox" className="sr-only peer" checked={voiceEnabled} onChange={(e) => setVoiceEnabled(e.target.checked)} />
                                              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-emerald-500"></div>
                                          </label>
                                      </div>
                                  </div>

                                  <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-800">
                                      <div className="space-y-2">
                                          <label className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono flex items-center gap-2"><Volume2 size={14} /> System Voice</label>
                                          <select 
                                            value={voiceId} 
                                            onChange={(e) => setVoiceId(e.target.value)} 
                                            className="w-full bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-2 text-sm font-mono"
                                          >
                                            <option value="af_sarah">Sarah (Natural Default)</option>
                                            <option value="af_sky">Sky (Clear & Fast)</option>
                                            <option value="af_heart">Heart (Warm)</option>
                                            <option value="af_bella">Bella (Soft)</option>
                                            <option value="af_nicole">Nicole (Professional)</option>
                                            <option value="am_michael">Michael (Male - Warm)</option>
                                            <option value="am_adam">Adam (Male - Clear)</option>
                                          </select>
                                          <p className="text-[10px] text-gray-500">Select the high-quality Kokoro voice for system feedback.</p>
                                      </div>
                                  </div>

                                  <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-800">
                                      <div className="space-y-4">
                                          <div className="flex items-center justify-between">
                                              <div className="font-bold text-sm">Saved Voice Profiles</div>
                                              <span className="text-[10px] font-mono text-gray-500 uppercase">{Object.keys(voiceProfiles).length} Profile(s)</span>
                                          </div>

                                          {Object.keys(voiceProfiles).length > 0 ? (
                                              <div className="space-y-2">
                                                  {Object.entries(voiceProfiles).map(([name, _]) => (
                                                      <div key={name} className="flex items-center justify-between p-3 bg-white dark:bg-gray-950 rounded-lg border border-gray-200 dark:border-gray-800 group transition-all hover:border-indigo-500/30">
                                                          <div className="flex items-center gap-3">
                                                              <div className="p-2 bg-indigo-500/10 rounded-full text-indigo-500">
                                                                  <Mic size={14} />
                                                              </div>
                                                              <span className="text-sm font-bold text-gray-700 dark:text-gray-200">{name}</span>
                                                          </div>
                                                          <button 
                                                            onClick={() => handleDeleteProfile(name)}
                                                            className="p-2 text-gray-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-500/10 opacity-0 group-hover:opacity-100"
                                                          >
                                                              <Trash2 size={14} />
                                                          </button>
                                                      </div>
                                                  ))}
                                              </div>
                                          ) : (
                                              <div className="p-8 border-2 border-dashed border-gray-200 dark:border-gray-800 rounded-xl flex flex-col items-center justify-center gap-2">
                                                  <Mic size={24} className="text-gray-300" />
                                                  <p className="text-xs text-gray-500">No voice profiles saved yet.</p>
                                              </div>
                                          )}
                                      </div>
                                  </div>

                                  <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-800">
                                      <div className="flex items-center justify-between mb-2">
                                          <div className="space-y-1">
                                              <div className="font-bold text-sm">New Speaker Calibration</div>
                                              <p className="text-xs text-gray-500">Record a new voice fingerprint to identify a user.</p>
                                          </div>
                                      </div>

                                      <div className="space-y-4">
                                          <div className="space-y-2">
                                              <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 font-mono">User / Profile Name</label>
                                              <input 
                                                type="text" 
                                                value={profileName} 
                                                onChange={(e) => setProfileName(e.target.value)} 
                                                className="w-full bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-2 text-sm font-mono" 
                                                placeholder="Enter your name"
                                              />
                                          </div>

                                          <div className="bg-white dark:bg-gray-950 p-4 rounded-xl border border-gray-200 dark:border-gray-800 flex items-center justify-between">
                                              <div className="flex items-center gap-4">
                                                  <div className={`p-3 rounded-full ${isEnrolling ? 'bg-red-500 animate-pulse' : (isEnrollmentComplete ? 'bg-emerald-500' : 'bg-gray-100 dark:bg-gray-800')} transition-all`}>
                                                      {isEnrollmentComplete && !isEnrolling ? (
                                                          <CheckCircle2 size={20} className="text-white" />
                                                      ) : (
                                                          <Mic size={20} className={isEnrolling ? 'text-white' : 'text-gray-400'} />
                                                      )}
                                                  </div>
                                                  <div>
                                                      <div className="text-sm font-bold">
                                                          {isEnrolling ? 'Listening to your voice...' : (isEnrollmentComplete ? 'Voice Profile Finalized' : 'Voice Fingerprinting')}
                                                      </div>
                                                      <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">
                                                          {isEnrolling ? `RECORDING PHRASE ${enrollmentProgress + 1} OF ${ENROLLMENT_PHRASES.length}` : (isEnrollmentComplete ? 'READY FOR SECURE INTERACTION' : 'IDLE - READY TO ENROLL')}
                                                      </div>
                                                  </div>
                                              </div>

                                              {!isEnrolling ? (
                                                  <button 
                                                    onClick={() => {
                                                        setIsEnrolling(true);
                                                        setIsEnrollmentComplete(false);
                                                        setEnrollmentProgress(0);
                                                        window.api.startVoiceEnrollment(ENROLLMENT_PHRASES[0]);
                                                    }}
                                                    disabled={!profileName.trim()}
                                                    className={`px-4 py-2 ${isEnrollmentComplete ? 'bg-gray-800 hover:bg-gray-700' : 'bg-indigo-600 hover:bg-indigo-700'} text-white rounded-lg text-xs font-bold transition-all shadow-md disabled:opacity-50`}
                                                  >
                                                      {isEnrollmentComplete ? 'Add Another Profile' : 'Start Calibration'}
                                                  </button>
                                              ) : (
                                                  <div className="text-xs font-bold text-red-500 animate-pulse">RECORDING...</div>
                                              )}
                                          </div>

                                          {isEnrolling && (
                                              <div className="p-4 bg-indigo-600 rounded-xl shadow-xl border-2 border-indigo-400 animate-in zoom-in-95">
                                                  <div className="text-[10px] text-indigo-200 font-bold uppercase tracking-widest mb-2">Please read the following phrase clearly:</div>
                                                  <div className="text-lg font-bold text-white leading-relaxed">
                                                      "{ENROLLMENT_PHRASES[enrollmentProgress]}"
                                                  </div>
                                                  <div className="mt-4 flex gap-1">
                                                      {ENROLLMENT_PHRASES.map((_, i) => (
                                                          <div key={i} className={`h-1.5 flex-1 rounded-full ${i <= enrollmentProgress ? 'bg-white' : 'bg-indigo-900/50'}`} />
                                                      ))}
                                                  </div>
                                              </div>
                                          )}

                                          {isEnrollmentComplete && !isEnrolling && (
                                              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg animate-in zoom-in-95">
                                                  <p className="text-xs text-emerald-700 dark:text-emerald-300 font-bold flex items-center gap-2">
                                                      <CheckCircle2 size={14} /> Profile successfully synchronized.
                                                  </p>
                                              </div>
                                          )}
                                      </div>
                                  </div>

                                  <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-800">
                                      <div className="space-y-2">
                                          <label className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono flex items-center gap-2"><Mic size={14} /> System Name (Wake Word)</label>
                                          <input 
                                            type="text" 
                                            value={systemName} 
                                            onChange={(e) => setSystemName(e.target.value)} 
                                            className="w-full bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-2 text-sm font-mono" 
                                            placeholder="e.g. Signal, Jarvis, Zero"
                                          />
                                          <p className="text-[10px] text-gray-500">The system will only respond to its name when voice mode is active.</p>
                                      </div>
                                  </div>

                                  <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-800">
                                      <div className="space-y-2">
                                          <label className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono">Dominant Language</label>
                                          <select 
                                            value={dominantLanguage} 
                                            onChange={(e) => setDominantLanguage(e.target.value)} 
                                            className="w-full bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-2 text-sm font-mono"
                                          >
                                            <option value="en">English</option>
                                            <option value="zh">Chinese</option>
                                            <option value="fr">French</option>
                                            <option value="de">German</option>
                                            <option value="ja">Japanese</option>
                                            <option value="ko">Korean</option>
                                            <option value="es">Spanish</option>
                                          </select>
                                          <p className="text-[10px] text-gray-500">Improves speech-to-text accuracy and performance.</p>
                                      </div>
                                  </div>
                              </div>
                          </div>
                      </section>
                  )}

                  {activeTab === 'services' && (
                      <section className="space-y-6">
                          <div className="bg-white dark:bg-gray-900 p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-8">
                              <div className="space-y-6">
                                  <div className="flex items-center justify-between border-b pb-2">
                                      <div className="flex items-center gap-2 font-bold"><Search size={16} className="text-emerald-500" /> Web Search Providers</div>
                                      <p className="text-[10px] text-gray-500 font-mono uppercase tracking-tighter">Failover Priority: SerpApi &gt; Brave &gt; Tavily</p>
                                  </div>

                                  {/* SerpApi */}
                                  <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-800">
                                      <div className="flex items-center justify-between">
                                          <div className="font-bold text-sm">SerpApi (Google)</div>
                                          <label className="relative inline-flex items-center cursor-pointer">
                                              <input type="checkbox" className="sr-only peer" checked={serpApiEnabled} onChange={(e) => setSerpApiEnabled(e.target.checked)} />
                                              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-emerald-500"></div>
                                          </label>
                                      </div>
                                      <div className="space-y-1">
                                          <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 font-mono">API Key</label>
                                          <input type="password" value={serpApiKey} onChange={(e) => setSerpApiKey(e.target.value)} className="w-full bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-2 text-sm font-mono" placeholder="Enter SerpApi Key" />
                                      </div>
                                  </div>

                                  {/* Brave Search */}
                                  <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-800">
                                      <div className="flex items-center justify-between">
                                          <div className="font-bold text-sm">Brave Search</div>
                                          <label className="relative inline-flex items-center cursor-pointer">
                                              <input type="checkbox" className="sr-only peer" checked={braveEnabled} onChange={(e) => setBraveEnabled(e.target.checked)} />
                                              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-emerald-500"></div>
                                          </label>
                                      </div>
                                      <div className="space-y-1">
                                          <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 font-mono">API Key</label>
                                          <input type="password" value={braveApiKey} onChange={(e) => setBraveApiKey(e.target.value)} className="w-full bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-2 text-sm font-mono" placeholder="Enter Brave Search API Key" />
                                      </div>
                                  </div>

                                  {/* Tavily */}
                                  <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-800">
                                      <div className="flex items-center justify-between">
                                          <div className="font-bold text-sm">Tavily Search</div>
                                          <label className="relative inline-flex items-center cursor-pointer">
                                              <input type="checkbox" className="sr-only peer" checked={tavilyEnabled} onChange={(e) => setTavilyEnabled(e.target.checked)} />
                                              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-emerald-500"></div>
                                          </label>
                                      </div>
                                      <div className="space-y-1">
                                          <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 font-mono">API Key</label>
                                          <input type="password" value={tavilyApiKey} onChange={(e) => setTavilyApiKey(e.target.value)} className="w-full bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-2 text-sm font-mono" placeholder="Enter Tavily API Key" />
                                      </div>
                                  </div>
                              </div>
                          </div>
                      </section>
                  )}

                  {activeTab === 'monitoring' && (
                      <section className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                          <div className="flex items-center justify-between">
                              <div>
                                  <h2 className="text-lg font-bold mb-1">World Monitoring</h2>
                                  <p className="text-sm text-gray-500">Automated polling and summarization of external data sources.</p>
                              </div>
                              <label className="relative inline-flex items-center cursor-pointer">
                                  <input type="checkbox" className="sr-only peer" checked={monitoringEnabled} onChange={(e) => setMonitoringEnabled(e.target.checked)} />
                                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-emerald-500"></div>
                                  <span className="ml-3 text-sm font-medium text-gray-600 dark:text-gray-400">{monitoringEnabled ? 'System Active' : 'System Paused'}</span>
                              </label>
                          </div>

                          <div className="bg-white dark:bg-gray-900 p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-6">
                              <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-4">
                                  <h3 className="font-bold text-sm flex items-center gap-2"><Database size={16} className="text-indigo-500" /> Monitoring Sources</h3>
                                  <button 
                                    onClick={() => {
                                        const newSource = {
                                            id: `mon-${Date.now()}`,
                                            name: 'New Source',
                                            enabled: true,
                                            url: '',
                                            pollingIntervalMs: 3600000, // 1 hour
                                            type: 'rss'
                                        };
                                        setMonitoringSources([...monitoringSources, newSource]);
                                    }}
                                    className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-xs font-bold transition-colors"
                                  >
                                      <Plus size={14} /> Add Source
                                  </button>
                              </div>

                              <div className="space-y-6">
                                  {monitoringSources.length === 0 ? (
                                      <div className="py-12 text-center opacity-40">
                                          <Activity size={48} className="mx-auto mb-2" />
                                          <p className="text-sm font-mono uppercase tracking-widest">No_Sources_Configured</p>
                                      </div>
                                  ) : (
                                      <>
                                          {/* System Sources */}
                                          <div className="space-y-4">
                                              <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 border-b border-gray-100 dark:border-gray-800 pb-1">System Monitoring Sources</div>
                                              {monitoringSources.filter(s => !s.id.startsWith('mon-')).map((source) => (
                                                  <div key={source.id} className="p-4 bg-indigo-50/30 dark:bg-indigo-900/10 rounded-lg border border-indigo-100/50 dark:border-indigo-900/20 space-y-4">
                                                      <div className="flex items-center justify-between">
                                                          <div className="flex items-center gap-2">
                                                              <div className="font-bold text-sm text-indigo-700 dark:text-indigo-300">{source.name}</div>
                                                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 font-bold uppercase">{source.type}</span>
                                                          </div>
                                                          <div className="flex items-center gap-3 ml-4 pt-4">
                                                              <button 
                                                                  onClick={() => handlePollSource(source.id)}
                                                                  className="p-1.5 text-indigo-600 hover:text-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 rounded-md transition-colors"
                                                                  title="Run Poll Now"
                                                              >
                                                                  <Play size={14} fill="currentColor" />
                                                              </button>
                                                              <label className="relative inline-flex items-center cursor-pointer">
                                                                  <input type="checkbox" className="sr-only peer" checked={source.enabled} onChange={(e) => {
                                                                      const updated = [...monitoringSources];
                                                                      const idx = updated.findIndex(s => s.id === source.id);
                                                                      updated[idx].enabled = e.target.checked;
                                                                      setMonitoringSources(updated);
                                                                  }} />
                                                                  <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-emerald-500"></div>
                                                              </label>
                                                          </div>
                                                      </div>
                                                      
                                                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                          <div className="space-y-1">
                                                              <label className="text-[10px] font-bold uppercase text-gray-500 font-mono">Endpoint / API URL</label>
                                                              <input 
                                                                  type="text" 
                                                                  value={source.url} 
                                                                  onChange={(e) => {
                                                                      const updated = [...monitoringSources];
                                                                      const idx = updated.findIndex(s => s.id === source.id);
                                                                      updated[idx].url = e.target.value;
                                                                      setMonitoringSources(updated);
                                                                  }}
                                                                  className="w-full bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded px-3 py-1.5 text-xs font-mono"
                                                              />
                                                          </div>
                                                          {(source.type === 'api' || source.id.includes('acled') || source.id.includes('stack') || source.id.includes('vantage')) && (
                                                              <div className="space-y-4">
                                                                  <div className="space-y-1">
                                                                      <label className="text-[10px] font-bold uppercase text-gray-500 font-mono">API Key / Auth</label>
                                                                      <input 
                                                                          type="password" 
                                                                          value={source.metadata?.apiKey || ''} 
                                                                          onChange={(e) => {
                                                                              const updated = [...monitoringSources];
                                                                              const idx = updated.findIndex(s => s.id === source.id);
                                                                              updated[idx].metadata = { ...(updated[idx].metadata || {}), apiKey: e.target.value };
                                                                              setMonitoringSources(updated);
                                                                          }}
                                                                          placeholder="Enter key if required"
                                                                          className="w-full bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded px-3 py-1.5 text-xs font-mono"
                                                                      />
                                                                  </div>
                                                                  {source.id === 'acled' && (
                                                                      <div className="space-y-1">
                                                                          <label className="text-[10px] font-bold uppercase text-gray-500 font-mono">Registered Email</label>
                                                                          <input 
                                                                              type="text" 
                                                                              value={source.metadata?.email || ''} 
                                                                              onChange={(e) => {
                                                                                  const updated = [...monitoringSources];
                                                                                  const idx = updated.findIndex(s => s.id === source.id);
                                                                                  updated[idx].metadata = { ...(updated[idx].metadata || {}), email: e.target.value };
                                                                                  setMonitoringSources(updated);
                                                                              }}
                                                                              placeholder="email@example.com"
                                                                              className="w-full bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded px-3 py-1.5 text-xs font-mono"
                                                                          />
                                                                      </div>
                                                                  )}
                                                              </div>
                                                          )}
                                                      </div>

                                                      <div className="flex items-center justify-between text-[10px] text-gray-500 font-mono pt-2 border-t border-indigo-100/30 dark:border-indigo-900/20">
                                                          <div>Last Poll: {source.lastPolledAt ? new Date(source.lastPolledAt).toLocaleString() : 'Never'}</div>
                                                          <div className="flex items-center gap-2">
                                                              <span>Interval (ms):</span>
                                                              <input 
                                                                  type="number" 
                                                                  value={source.pollingIntervalMs} 
                                                                  onChange={(e) => {
                                                                      const updated = [...monitoringSources];
                                                                      const idx = updated.findIndex(s => s.id === source.id);
                                                                      updated[idx].pollingIntervalMs = parseInt(e.target.value);
                                                                      setMonitoringSources(updated);
                                                                  }}
                                                                  className="w-20 bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded px-2 py-0.5"
                                                              />
                                                          </div>
                                                      </div>
                                                  </div>
                                              ))}
                                          </div>

                                          {/* Custom Sources */}
                                          <div className="space-y-4 pt-4">
                                              <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 border-b border-gray-100 dark:border-gray-800 pb-1">Custom Monitoring Sources</div>
                                              {monitoringSources.filter(s => s.id.startsWith('mon-')).map((source) => (
                                                  <div key={source.id} className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-800 space-y-4">
                                                      <div className="flex items-center justify-between">
                                                          <div className="flex-1 grid grid-cols-2 gap-4">
                                                              <div className="space-y-1">
                                                                  <label className="text-[10px] font-bold uppercase text-gray-500 font-mono">Source Name</label>
                                                                  <input 
                                                                      type="text" 
                                                                      value={source.name} 
                                                                      onChange={(e) => {
                                                                          const updated = [...monitoringSources];
                                                                          const idx = updated.findIndex(s => s.id === source.id);
                                                                          updated[idx].name = e.target.value;
                                                                          setMonitoringSources(updated);
                                                                      }}
                                                                      className="w-full bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded px-3 py-1.5 text-sm"
                                                                  />
                                                              </div>
                                                              <div className="space-y-1">
                                                                  <label className="text-[10px] font-bold uppercase text-gray-500 font-mono">Type</label>
                                                                  <select 
                                                                      value={source.type}
                                                                      onChange={(e) => {
                                                                          const updated = [...monitoringSources];
                                                                          const idx = updated.findIndex(s => s.id === source.id);
                                                                          updated[idx].type = e.target.value;
                                                                          setMonitoringSources(updated);
                                                                      }}
                                                                      className="w-full bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded px-3 py-1.5 text-sm"
                                                                  >
                                                                      <option value="rss">RSS Feed</option>
                                                                      <option value="api">JSON API</option>
                                                                      <option value="web">Web Page (Scrape)</option>
                                                                  </select>
                                                              </div>
                                                          </div>
                                                          <div className="flex items-center gap-2 ml-4 pt-4">
                                                              <button 
                                                                  onClick={() => handlePollSource(source.id)}
                                                                  className="p-1.5 text-indigo-600 hover:text-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 rounded-md transition-colors"
                                                                  title="Run Poll Now"
                                                              >
                                                                  <Play size={14} fill="currentColor" />
                                                              </button>
                                                              <label className="relative inline-flex items-center cursor-pointer">
                                                                  <input type="checkbox" className="sr-only peer" checked={source.enabled} onChange={(e) => {
                                                                      const updated = [...monitoringSources];
                                                                      const idx = updated.findIndex(s => s.id === source.id);
                                                                      updated[idx].enabled = e.target.checked;
                                                                      setMonitoringSources(updated);
                                                                  }} />
                                                                  <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-indigo-500"></div>
                                                              </label>
                                                              <button 
                                                                  onClick={() => setMonitoringSources(monitoringSources.filter(s => s.id !== source.id))}
                                                                  className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                                                              >
                                                                  <Trash2 size={16} />
                                                              </button>
                                                          </div>
                                                      </div>
                                                      <div className="space-y-1">
                                                          <label className="text-[10px] font-bold uppercase text-gray-500 font-mono">Endpoint URL</label>
                                                          <input 
                                                              type="text" 
                                                              value={source.url} 
                                                              onChange={(e) => {
                                                                  const updated = [...monitoringSources];
                                                                  const idx = updated.findIndex(s => s.id === source.id);
                                                                  updated[idx].url = e.target.value;
                                                                  setMonitoringSources(updated);
                                                              }}
                                                              placeholder="https://..."
                                                              className="w-full bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded px-3 py-1.5 text-xs font-mono"
                                                          />
                                                      </div>
                                                      <div className="flex items-center justify-between text-[10px] text-gray-500 font-mono">
                                                          <div>Last Poll: {source.lastPolledAt ? new Date(source.lastPolledAt).toLocaleString() : 'Never'}</div>
                                                          <div className="flex items-center gap-2">
                                                              <span>Interval (ms):</span>
                                                              <input 
                                                                  type="number" 
                                                                  value={source.pollingIntervalMs} 
                                                                  onChange={(e) => {
                                                                      const updated = [...monitoringSources];
                                                                      const idx = updated.findIndex(s => s.id === source.id);
                                                                      updated[idx].pollingIntervalMs = parseInt(e.target.value);
                                                                      setMonitoringSources(updated);
                                                                  }}
                                                                  className="w-20 bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded px-2 py-0.5"
                                                              />
                                                          </div>
                                                      </div>
                                                  </div>
                                              ))}
                                          </div>
                                      </>
                                  )}
                              </div>
                          </div>
                      </section>
                  )}

                  {activeTab === 'appearance' && (
                      <section className="space-y-6">
                          <div className="bg-white dark:bg-gray-900 p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-6">
                              <div className="flex items-center justify-between">
                                  <div>
                                      <h4 className="font-bold text-sm text-gray-900 dark:text-gray-100">3D Reasoning Graph</h4>
                                      <p className="text-xs text-gray-500">Show the animated graphviz background in the chat view</p>
                                  </div>
                                  <label className="relative inline-flex items-center cursor-pointer">
                                      <input type="checkbox" className="sr-only peer" checked={showGraphviz} onChange={(e) => setShowGraphviz(e.target.checked)} />
                                      <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-emerald-500"></div>
                                  </label>
                              </div>
                          </div>
                      </section>
                  )}

                  {activeTab === 'mcp' && (
                      <section className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                          <div className="flex items-center justify-between">
                              <div>
                                  <h2 className="text-lg font-bold mb-1">MCP Servers</h2>
                                  <p className="text-sm text-gray-500">Extend AI capabilities with Model Context Protocol servers.</p>
                              </div>
                              <button 
                                  onClick={() => setIsMcpModalOpen(true)}
                                  className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs font-bold transition-colors"
                              >
                                  <Plus size={14} /> Add Server
                              </button>
                          </div>

                          <div className="grid grid-cols-1 gap-4">
                              {mcpConfigs.length === 0 ? (
                                  <div className="p-12 text-center border-2 border-dashed border-gray-200 dark:border-gray-800 rounded-xl bg-gray-50 dark:bg-gray-900/50">
                                      <Network size={48} className="mx-auto mb-4 text-gray-300 dark:text-gray-700" />
                                      <p className="text-gray-500 text-sm">No MCP servers configured.</p>
                                  </div>
                              ) : (
                                  mcpConfigs.map(config => (
                                      <div key={config.id} className="bg-white dark:bg-gray-900 p-4 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm flex items-center justify-between group">
                                          <div className="flex items-center gap-4">
                                              <div className={`p-2 rounded-lg ${config.enabled ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600'}`}>
                                                  <Server size={20} />
                                              </div>
                                              <div>
                                                  <div className="flex items-center gap-2">
                                                      <span className="font-bold text-sm">{config.name}</span>
                                                      {!config.enabled && <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 text-[9px] uppercase font-bold">Disabled</span>}
                                                  </div>
                                                  <div className="text-xs text-gray-500 font-mono truncate max-w-md">{config.endpoint}</div>
                                              </div>
                                          </div>
                                          <div className="flex items-center gap-2">
                                              <button 
                                                  onClick={() => {
                                                      const updated = mcpConfigs.map(c => c.id === config.id ? { ...c, enabled: !c.enabled } : c);
                                                      setMcpConfigs(updated);
                                                  }}
                                                  className={`px-3 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-colors ${config.enabled ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400 border border-emerald-500/20' : 'bg-gray-100 text-gray-500 dark:bg-gray-800'}`}
                                              >
                                                  {config.enabled ? 'Enabled' : 'Enable'}
                                              </button>
                                              <button 
                                                  onClick={() => handleRemoveMcp(config.id)}
                                                  className="p-2 text-gray-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                                              >
                                                  <Trash2 size={16} />
                                              </button>
                                          </div>
                                      </div>
                                  ))
                              )}
                          </div>
                      </section>
                  )}

                  {activeTab === 'hygiene' && (
                      <section className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                          <div>
                              <h2 className="text-lg font-bold mb-1">Graph Hygiene</h2>
                              <p className="text-sm text-gray-500">Maintain the integrity and coherence of the symbolic graph.</p>
                          </div>

                          <div className="bg-white dark:bg-gray-900 p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-8">
                              {/* Intelligence Automation (Top Group) */}
                              <div className="space-y-4">
                                  <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Intelligence Automation</div>
                                  <div className="space-y-3">
                                      {[
                                          { id: 'semantic', label: 'Semantic Intelligence', desc: 'Vector-based similarity analysis.', icon: Cpu },
                                          { id: 'triadic', label: 'Triadic Resonance', desc: 'Emoji-based structural analysis.', icon: Database }
                                      ].map(strat => (
                                          <div key={strat.id} className="p-4 bg-indigo-50/30 dark:bg-indigo-900/10 rounded-lg border border-indigo-100/50 dark:border-indigo-900/20 flex items-center justify-between">
                                              <div className="flex items-center gap-4">
                                                  <div className="p-2 bg-white dark:bg-gray-800 rounded-lg text-indigo-600 shadow-sm">
                                                      <strat.icon size={20} />
                                                  </div>
                                                  <div>
                                                      <div className="font-bold text-sm text-indigo-700 dark:text-indigo-300">{strat.label}</div>
                                                      <div className="text-xs text-gray-500">{strat.desc}</div>
                                                  </div>
                                              </div>

                                              <div className="flex items-center gap-8">
                                                  <div className="flex items-center gap-6">
                                                      <label className="flex items-center gap-2 cursor-pointer group">
                                                          <input
                                                              type="checkbox"
                                                              checked={(hygieneSettings as any)[strat.id].autoCompress}
                                                              onChange={(e) => setHygieneSettings({
                                                                  ...hygieneSettings,
                                                                  [strat.id]: { ...(hygieneSettings as any)[strat.id], autoCompress: e.target.checked }
                                                              })}
                                                              className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                                          />
                                                          <span className="text-xs font-medium text-gray-600 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-gray-200 transition-colors">Auto-Compress</span>
                                                      </label>
                                                      <label className="flex items-center gap-2 cursor-pointer group">
                                                          <input
                                                              type="checkbox"
                                                              checked={(hygieneSettings as any)[strat.id].autoLink}
                                                              onChange={(e) => setHygieneSettings({
                                                                  ...hygieneSettings,
                                                                  [strat.id]: { ...(hygieneSettings as any)[strat.id], autoLink: e.target.checked }
                                                              })}
                                                              className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                                          />
                                                          <span className="text-xs font-medium text-gray-600 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-gray-200 transition-colors">Auto-Link</span>
                                                      </label>
                                                  </div>

                                                  <button
                                                      onClick={() => handleRunHygiene(strat.id)}
                                                      disabled={isRunningHygiene !== null}
                                                      className="flex items-center gap-2 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded-md text-xs font-bold transition-colors"
                                                  >
                                                      {isRunningHygiene === strat.id ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} fill="currentColor" />}
                                                      Run Now
                                                  </button>
                                              </div>
                                          </div>
                                      ))}
                                  </div>
                              </div>

                              {/* Analysis & Healing Strategies (Consolidated List) */}
                              <div className="space-y-6 pt-6 border-t border-gray-100 dark:border-gray-800">
                                  <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Analysis & Healing Strategies</div>
                                  <div className="space-y-4">
                                      {[
                                          { id: 'refactor', settingKey: 'refactorLinks', label: 'Canonical Link Refactoring', desc: 'Consolidates redundant link types into their canonical forms.' },
                                          { id: 'reflexive', settingKey: 'reflexiveLinks', label: 'Reflexive Link Synthesis', desc: 'Automatically creates reciprocal relationships (e.g., A part_of B -> B contains A).' },
                                          { id: 'bridge', settingKey: 'bridgeIslands', label: 'Island Bridging & Orphan Healing', desc: 'Analyzes disconnected subgraphs and orphaned symbols, suggesting bridge links to the mainland.' },
                                          { id: 'domainRefactor', settingKey: 'domainRefactor', label: 'Domain Lattice Docking', desc: 'Anchors unlinked patterns into appropriate domain lattices.' },
                                          { id: 'bridgeLifting', settingKey: 'bridgeLifting', label: 'Bridge Lifting', desc: 'Elevates cross-domain pattern links to the lattice level for structural clarity.' },
                                          { id: 'promotion', settingKey: 'linkPromotion', label: 'Link Promotion', desc: 'Promotes high-confidence "relates_to" links to specific semantic types.' },
                                          { id: 'deadLinkCleanup', settingKey: 'deadLinkCleanup', label: 'Dead Link Cleanup', desc: 'Removes links pointing to non-existent symbols.' }
                                      ].map(strat => (
                                          <div key={strat.id + (strat.settingKey || '')} className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-800 flex items-center justify-between">
                                              <div className="flex-1">
                                                  <div className="flex items-center gap-3">
                                                      {strat.settingKey && (
                                                          <label className="relative inline-flex items-center cursor-pointer">
                                                              <input 
                                                                  type="checkbox" 
                                                                  className="sr-only peer" 
                                                                  checked={(hygieneSettings as any)[strat.settingKey]} 
                                                                  onChange={(e) => setHygieneSettings({...hygieneSettings, [strat.settingKey]: e.target.checked})}
                                                              />
                                                              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-indigo-500"></div>
                                                          </label>
                                                      )}
                                                      {!strat.settingKey && <div className="w-9 h-5 flex items-center justify-center opacity-30"><Play size={14} /></div>}
                                                      <div>
                                                          <div className="font-bold text-sm text-gray-900 dark:text-gray-100">{strat.label}</div>
                                                          <div className="text-xs text-gray-500">{strat.desc}</div>
                                                      </div>
                                                  </div>
                                              </div>
                                              <button
                                                  onClick={() => handleRunHygiene(strat.id)}
                                                  disabled={isRunningHygiene !== null}
                                                  className="flex items-center gap-2 px-3 py-1.5 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 text-gray-700 dark:text-gray-200 rounded-md text-xs font-bold transition-colors ml-4"
                                              >
                                                  {isRunningHygiene === strat.id ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} fill="currentColor" />}
                                                  Run Now
                                              </button>
                                          </div>
                                      ))}
                                  </div>
                              </div>
                          </div>
                      </section>
                  )}
              </div>
          </main>
      </div>

      {isMcpModalOpen && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
              <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-md w-full p-6 border border-gray-200 dark:border-gray-800 flex flex-col max-h-[90vh] overflow-hidden">
                  <div className="flex items-center justify-between mb-6">
                      <h3 className="font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2"><Plus size={18} className="text-emerald-500" /> Add MCP Server</h3>
                      <button onClick={() => { setIsMcpModalOpen(false); setValidationResult(null); }} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><XCircle size={20} /></button>
                  </div>

                  <div className="overflow-y-auto space-y-4 pr-2">
                      <div className="space-y-1">
                          <label className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono">Server Name</label>
                          <input 
                              placeholder="e.g. Memory Server"
                              className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-2 text-sm font-mono" 
                              value={newMcpName} 
                              onChange={e => setNewMcpName(e.target.value)} 
                          />
                      </div>
                      <div className="space-y-1">
                          <label className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono">Endpoint (URL)</label>
                          <input 
                              placeholder="http://localhost:3000/mcp"
                              className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-2 text-sm font-mono" 
                              value={newMcpEndpoint} 
                              onChange={e => setNewMcpEndpoint(e.target.value)} 
                          />
                      </div>
                      <div className="space-y-1">
                          <label className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono">Authorization Token (Optional)</label>
                          <input 
                              type="password"
                              placeholder="Bearer token or API key"
                              className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-2 text-sm font-mono" 
                              value={newMcpToken} 
                              onChange={e => setNewMcpToken(e.target.value)} 
                          />
                      </div>

                      {validationResult && (
                          <div className={`p-3 rounded-lg border text-xs flex items-start gap-3 ${validationResult.success ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800' : 'bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800'}`}>
                              {validationResult.success ? <CheckCircle2 size={16} className="shrink-0" /> : <XCircle size={16} className="shrink-0" />}
                              <div className="space-y-1">
                                  <div className="font-bold">{validationResult.success ? 'Validation Successful' : 'Validation Failed'}</div>
                                  <p>{validationResult.success ? `Found ${validationResult.toolCount} tools available on this server.` : validationResult.error}</p>
                              </div>
                          </div>
                      )}
                  </div>

                  <div className="flex justify-between items-center mt-8 pt-4 border-t border-gray-100 dark:border-gray-800">
                      <button 
                          onClick={handleValidateMcp}
                          disabled={!newMcpEndpoint || isValidatingMcp}
                          className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-indigo-600 hover:text-indigo-700 disabled:text-gray-400 transition-colors"
                      >
                          {isValidatingMcp ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
                          Validate Server
                      </button>
                      <div className="flex gap-2">
                          <button onClick={() => { setIsMcpModalOpen(false); setValidationResult(null); }} className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-gray-700">Cancel</button>
                          <button 
                              onClick={handleAddMcp} 
                              disabled={!newMcpName || !newMcpEndpoint || !validationResult?.success} 
                              className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 dark:disabled:bg-gray-800 text-white rounded-lg text-xs font-bold transition-all shadow-md"
                          >
                              Add Server
                          </button>
                      </div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};
