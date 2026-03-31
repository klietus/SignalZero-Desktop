import React, { useState } from 'react';
import { Shield, Save, Loader2, Search } from 'lucide-react';

interface SetupScreenProps {
    onComplete: () => void;
}

export const SetupScreen: React.FC<SetupScreenProps> = ({ onComplete }) => {
    const [licenseAccepted, setLicenseAccepted] = useState(false);
    
    // Inference Settings
    const [inferenceProvider, setInferenceProvider] = useState<'local' | 'openai' | 'gemini' | 'kimi2'>('local');
    const [inferenceApiKey, setInferenceApiKey] = useState('');
    const [inferenceEndpoint, setInferenceEndpoint] = useState('http://localhost:1234/v1');
    const [inferenceModel, setInferenceModel] = useState('openai/gpt-oss-120b');
    const [inferenceFastModel, setInferenceFastModel] = useState('qwen/qwen3.5-0.8b');

    // Web Search
    const [serpApiKey, setSerpApiKey] = useState('');
    const [braveApiKey, setBraveApiKey] = useState('');
    const [tavilyApiKey, setTavilyApiKey] = useState('');

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleProviderChange = (newProvider: 'local' | 'openai' | 'gemini' | 'kimi2') => {
        setInferenceProvider(newProvider);
        if (newProvider === 'local') {
             setInferenceEndpoint('http://localhost:1234/v1');
             setInferenceModel('openai/gpt-oss-120b');
             setInferenceFastModel('qwen/qwen3.5-0.8b');
        } else if (newProvider === 'openai') {
             setInferenceEndpoint('https://api.openai.com/v1');
             setInferenceModel('gpt-4-turbo-preview');
             setInferenceFastModel('gpt-4o-mini');
        } else if (newProvider === 'kimi2') {
             setInferenceEndpoint('https://api.moonshot.ai/v1');
             setInferenceModel('kimi-k2-thinking');
             setInferenceFastModel('kimi-k2-thinking');
        } else {
             setInferenceEndpoint('https://generativelanguage.googleapis.com');
             setInferenceModel('gemini-2.5-pro');
             setInferenceFastModel('gemini-1.5-flash');
        }
    };

    const handleSetup = async () => {
        if (!licenseAccepted) {
            setError("You must accept the license agreement to proceed.");
            return;
        }

        setLoading(true);
        setError(null);

        try {
            await window.api.updateSettings({
                serpApi: { apiKey: serpApiKey, enabled: !!serpApiKey },
                braveSearch: { apiKey: braveApiKey, enabled: !!braveApiKey },
                tavily: { apiKey: tavilyApiKey, enabled: !!tavilyApiKey },
                inference: {
                    provider: inferenceProvider,
                    apiKey: inferenceApiKey,
                    endpoint: inferenceEndpoint,
                    model: inferenceModel,
                    agentModel: inferenceModel,
                    visionModel: inferenceProvider === 'openai' ? 'gpt-4o-mini' : (inferenceProvider === 'gemini' ? 'gemini-2.5-flash-lite' : (inferenceProvider === 'kimi2' ? 'kimi-k2-thinking' : 'zai-org/glm-4.6v-flash')),
                    fastModel: inferenceFastModel
                }
            });
            onComplete();
        } catch (err: any) {
            setError(err.message || "Initialization failed.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-6 font-sans">
            <div className="max-w-2xl w-full bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                <div className="p-8 md:p-12">
                    <div className="flex items-center gap-4 mb-8">
                        <div className="p-3 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl text-indigo-600 dark:text-indigo-400">
                            <Shield size={32} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">SignalZero Desktop</h1>
                            <p className="text-gray-500 dark:text-gray-400 text-sm">System Initialization & Configuration</p>
                        </div>
                    </div>

                    <div className="space-y-8">
                        {error && (
                            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm font-mono flex items-center gap-3 animate-in fade-in zoom-in duration-300">
                                <Search size={18} /> {error}
                            </div>
                        )}

                        {/* License Section */}
                        <section className="space-y-4">
                            <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 font-mono">1. License Agreement</h3>
                            <div className="p-4 bg-gray-50 dark:bg-gray-950 rounded-lg border border-gray-100 dark:border-gray-800 text-xs text-gray-600 dark:text-gray-400 leading-relaxed max-h-32 overflow-y-auto font-mono">
                                SignalZero is licensed under **Creative Commons Attribution-NonCommercial 4.0 International**.
                                Commercial use is strictly prohibited without a separate commercial license.
                                By initializing, you agree to use this software for non-commercial purposes only.
                            </div>
                            <label className="flex items-center gap-3 cursor-pointer group">
                                <input 
                                    type="checkbox" 
                                    checked={licenseAccepted}
                                    onChange={(e) => setLicenseAccepted(e.target.checked)}
                                    className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" 
                                />
                                <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-indigo-500 transition-colors">I accept the non-commercial license agreement.</span>
                            </label>
                        </section>

                        {/* Inference Provider */}
                        <section className="space-y-4">
                            <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 font-mono">2. AI Provider Setup</h3>
                            <div className="bg-gray-100 dark:bg-gray-800 p-1 rounded-lg grid grid-cols-4 gap-1">
                                {['local', 'openai', 'gemini', 'kimi2'].map(p => (
                                    <button 
                                        key={p} 
                                        onClick={() => handleProviderChange(p as any)}
                                        className={`py-2 rounded-md text-xs font-bold font-mono transition-all ${inferenceProvider === p ? 'bg-white dark:bg-gray-700 text-indigo-600 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
                                    >
                                        {p.toUpperCase()}
                                    </button>
                                ))}
                            </div>

                            <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-500">
                                {inferenceProvider !== 'local' && (
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-gray-600 dark:text-gray-400 font-mono block">API Key</label>
                                        <input 
                                            type="password" 
                                            value={inferenceApiKey}
                                            onChange={(e) => setInferenceApiKey(e.target.value)}
                                            placeholder="Enter your provider API key"
                                            className="w-full bg-gray-100 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                                        />
                                    </div>
                                )}

                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-gray-600 dark:text-gray-400 font-mono block">Endpoint</label>
                                    <input 
                                        type="text" 
                                        value={inferenceEndpoint}
                                        onChange={(e) => setInferenceEndpoint(e.target.value)}
                                        className="w-full bg-gray-100 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-gray-600 dark:text-gray-400 font-mono block">Chat Model</label>
                                        <input 
                                            type="text" 
                                            value={inferenceModel}
                                            onChange={(e) => setInferenceModel(e.target.value)}
                                            className="w-full bg-gray-100 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-gray-600 dark:text-gray-400 font-mono block">Fast Model</label>
                                        <input 
                                            type="text" 
                                            value={inferenceFastModel}
                                            onChange={(e) => setInferenceFastModel(e.target.value)}
                                            className="w-full bg-gray-100 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                                        />
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Search Section */}
                        <section className="space-y-4">
                            <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 font-mono">3. Grounding (Optional)</h3>
                            <div className="space-y-4">
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-gray-600 dark:text-gray-400 font-mono block">SerpApi Key</label>
                                    <input 
                                        type="password" 
                                        value={serpApiKey}
                                        onChange={(e) => setSerpApiKey(e.target.value)}
                                        placeholder="Optional: Google Search grounding"
                                        className="w-full bg-gray-100 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-gray-600 dark:text-gray-400 font-mono block">Brave Search Key</label>
                                    <input 
                                        type="password" 
                                        value={braveApiKey}
                                        onChange={(e) => setBraveApiKey(e.target.value)}
                                        placeholder="Optional: Brave Search grounding"
                                        className="w-full bg-gray-100 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-gray-600 dark:text-gray-400 font-mono block">Tavily API Key</label>
                                    <input 
                                        type="password" 
                                        value={tavilyApiKey}
                                        onChange={(e) => setTavilyApiKey(e.target.value)}
                                        placeholder="Optional: Tavily Search grounding"
                                        className="w-full bg-gray-100 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                                    />
                                </div>
                            </div>
                        </section>

                        <div className="pt-6">
                            <button 
                                onClick={handleSetup}
                                disabled={loading || !licenseAccepted}
                                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold font-mono py-4 rounded-xl shadow-lg shadow-indigo-500/20 transition-all flex items-center justify-center gap-3 text-lg"
                            >
                                {loading ? <Loader2 className="animate-spin" /> : <><Save size={20} /> Initialize Kernel</>}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
