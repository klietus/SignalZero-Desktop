import React, { useState, useEffect } from 'react';
import { 
    Save, Database, Network, Cpu, Cloud, 
    Search, AlertCircle, Mic, Layout
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
  
  // SerpApi State
  const [serpApiKey, setSerpApiKey] = useState('');
  
  // Inference State
  const [inferenceProvider, setInferenceProvider] = useState<'local' | 'openai' | 'gemini' | 'kimi2'>('local');
  const [inferenceApiKey, setInferenceApiKey] = useState('');
  const [inferenceEndpoint, setInferenceEndpoint] = useState('');
  const [inferenceModel, setInferenceModel] = useState('');
  const [inferenceAgentModel, setInferenceAgentModel] = useState('');
  const [inferenceVisionModel, setInferenceVisionModel] = useState('');
  const [inferenceFastModel, setInferenceFastModel] = useState('');

  // Graph Hygiene State
  const [hygieneSettings, setHygieneSettings] = useState<GraphHygieneSettings>({
    positional: { autoCompress: false, autoLink: false },
    semantic: { autoCompress: false, autoLink: false },
    triadic: { autoCompress: false, autoLink: false },
    deadLinkCleanup: false,
    orphanAnalysis: false
  });

  // UI Settings
  const [showGraphviz, setShowGraphviz] = useState(true);

  // Voice Server State
  const [pulseServer, setPulseServer] = useState('');
  const [wakeWord, setWakeWord] = useState('');
  const [selectedVoice, setSelectedVoice] = useState('af_sarah');

  const VOICES = [
    { id: 'af_sarah', name: 'American Female Sarah' },
    { id: 'af_heart', name: 'American Female Heart' },
    { id: 'af_alloy', name: 'American Female Alloy' },
    { id: 'af_aoede', name: 'American Female Aoede' },
    { id: 'af_bella', name: 'American Female Bella' },
    { id: 'af_jessica', name: 'American Female Jessica' },
    { id: 'af_kore', name: 'American Female Kore' },
    { id: 'af_nicole', name: 'American Female Nicole' },
    { id: 'af_nova', name: 'American Female Nova' },
    { id: 'af_river', name: 'American Female River' },
    { id: 'af_sky', name: 'American Female Sky' },
    { id: 'am_adam', name: 'American Male Adam' },
    { id: 'am_echo', name: 'American Male Echo' },
    { id: 'am_eric', name: 'American Male Eric' },
    { id: 'am_fenrir', name: 'American Male Fenrir' },
    { id: 'am_liam', name: 'American Male Liam' },
    { id: 'am_michael', name: 'American Male Michael' },
    { id: 'am_onyx', name: 'American Male Onyx' },
    { id: 'am_puck', name: 'American Male Puck' },
    { id: 'am_santa', name: 'American Male Santa' }
  ];

  // MCP State
  const [mcpConfigs, setMcpConfigs] = useState<McpConfiguration[]>([]);
  const [storedConfigs, setStoredConfigs] = useState<Record<string, any>>({});
  
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hydrateSettings = (settings: any) => {
    const inference = settings.inference || {};
    const serpApi = settings.serpApi || {};
    const voice = settings.voice || {};
    const hygiene = settings.hygiene || {
        positional: { autoCompress: false, autoLink: false },
        semantic: { autoCompress: false, autoLink: false },
        triadic: { autoCompress: false, autoLink: false },
        deadLinkCleanup: false,
        orphanAnalysis: false
    };

    setSerpApiKey(serpApi.apiKey || '');
    setPulseServer(voice.pulseServer || '');
    setWakeWord(voice.wakeWord || 'axiom');
    setSelectedVoice(voice.voice || 'af_sarah');
    setMcpConfigs(settings.mcpConfigs || []);

    setShowGraphviz(settings.ui?.showGraphviz ?? true);

    const provider = inference.provider || 'local';
    setInferenceProvider(provider);
    setInferenceApiKey(inference.apiKey || '');
    setInferenceEndpoint(inference.endpoint || '');
    setInferenceModel(inference.model || '');
    setInferenceAgentModel(inference.agentModel || inference.model || '');
    setInferenceVisionModel(inference.visionModel || '');
    setInferenceFastModel(inference.fastModel || '');
    
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
    try {
        const currentConfig = {
          apiKey: inferenceApiKey,
          endpoint: inferenceEndpoint,
          model: inferenceModel,
          agentModel: inferenceAgentModel,
          visionModel: inferenceVisionModel,
          fastModel: inferenceFastModel
        };
        const finalConfigs = { ...storedConfigs, [inferenceProvider]: currentConfig };

        await window.api.updateSettings({
            ui: { showGraphviz },
            serpApi: { apiKey: serpApiKey },
            voice: { pulseServer, wakeWord, voice: selectedVoice },
            hygiene: hygieneSettings,
            inference: {
                provider: inferenceProvider,
                apiKey: inferenceApiKey,
                endpoint: inferenceEndpoint,
                model: inferenceModel,
                agentModel: inferenceAgentModel,
                visionModel: inferenceVisionModel,
                fastModel: inferenceFastModel,
                savedConfigs: finalConfigs
            },
            mcpConfigs
        });
        alert('Settings saved!');
    } catch (err) {
        setError('Failed to save settings.');
    } finally {
        setIsSaving(false);
    }
  };

  const tabs = [
      { id: 'appearance', label: 'Appearance', icon: Layout },
      { id: 'inference', label: 'Inference', icon: Cpu },
      { id: 'services', label: 'Services', icon: Cloud },
      { id: 'mcp', label: 'MCP Clients', icon: Network },
      { id: 'hygiene', label: 'Graph Hygiene', icon: Database },
      { id: 'voice', label: 'Voice Server', icon: Mic },
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
                                          <label className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono">Fast Model</label>
                                          <input type="text" value={inferenceFastModel} onChange={(e) => setInferenceFastModel(e.target.value)} className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-2 text-sm font-mono" />
                                      </div>
                                  </div>
                                  <p className="text-[10px] text-gray-500 mt-2">
                                      <span className="font-bold text-amber-600 uppercase mr-1">Note:</span> 
                                      Smaller primary models (&lt;10B) may be less accurate. Fast Model can be very small (0.8B).
                                  </p>
                              </div>
                          </div>
                      </section>
                  )}

                  {activeTab === 'services' && (
                      <section className="space-y-6">
                          <div className="bg-white dark:bg-gray-900 p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-6">
                              <div className="space-y-4">
                                  <div className="flex items-center gap-2 font-bold border-b pb-2"><Search size={16} className="text-emerald-500" /> SerpApi Key</div>
                                  <input type="password" value={serpApiKey} onChange={(e) => setSerpApiKey(e.target.value)} className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-2 text-sm font-mono" />
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

                  {activeTab === 'voice' && (
                      <section className="space-y-6">
                          <div className="bg-white dark:bg-gray-900 p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-6">
                              <div className="space-y-2">
                                  <label className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono">Wake Word</label>
                                  <input type="text" value={wakeWord} onChange={(e) => setWakeWord(e.target.value)} className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-2 text-sm font-mono" />
                              </div>
                              <div className="space-y-2">
                                  <label className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono">Voice</label>
                                  <select value={selectedVoice} onChange={(e) => setSelectedVoice(e.target.value)} className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-2 text-sm">
                                      {VOICES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                                  </select>
                              </div>
                          </div>
                      </section>
                  )}
              </div>
          </main>
      </div>
    </div>
  );
};
