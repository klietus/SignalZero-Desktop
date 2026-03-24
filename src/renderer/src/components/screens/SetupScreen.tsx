import React, { useState } from 'react';
import { Shield, Save, Loader2, FileText, Search } from 'lucide-react';
import { apiFetch } from '../../services/api';
import { projectService } from '../../services/projectService';

interface SetupScreenProps {
    onSetupComplete: (token: string, user: any) => void;
}

export const SetupScreen: React.FC<SetupScreenProps> = ({ onSetupComplete }) => {
    // License
    const [licenseAccepted, setLicenseAccepted] = useState(false);

    // Admin Account
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    // SerpApi
    const [serpApiKey, setSerpApiKey] = useState('');

    // Inference Settings
    const [inferenceProvider, setInferenceProvider] = useState<'local' | 'openai' | 'gemini' | 'kimi2'>('local');
    const [inferenceApiKey, setInferenceApiKey] = useState('');
    const [inferenceEndpoint, setInferenceEndpoint] = useState('http://localhost:1234/v1');
    const [inferenceModel, setInferenceModel] = useState('openai/gpt-oss-120b');
    const [inferenceFastModel, setInferenceFastModel] = useState('qwen/qwen3.5-0.8b');
    const [loadSample, setLoadSample] = useState(false);

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
        if (!username || !password) {
            setError("Username and password are required.");
            return;
        }
        if (password !== confirmPassword) {
            setError("Passwords do not match.");
            return;
        }

        setLoading(true);
        setError(null);

        const inferenceConfig = {
            provider: inferenceProvider,
            apiKey: inferenceApiKey,
            endpoint: inferenceEndpoint,
            model: inferenceModel,
            agentModel: inferenceModel, // Default agent model to same
            visionModel: inferenceProvider === 'openai' ? 'gpt-4o-mini' : (inferenceProvider === 'gemini' ? 'gemini-2.5-flash-lite' : (inferenceProvider === 'kimi2' ? 'kimi-k2-thinking' : 'zai-org/glm-4.6v-flash')),
            fastModel: inferenceFastModel
        };

        try {
            const res = await apiFetch('/auth/setup', {
                method: 'POST',
                body: JSON.stringify({
                    username,
                    password,
                    inference: inferenceConfig,
                    serpApi: {
                        apiKey: serpApiKey
                    }
                })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Setup failed');
            }

            const data = await res.json();
            localStorage.setItem('signalzero_auth_token', data.token);

            if (loadSample) {
                try {
                    const sampleRes = await fetch('/signalzero_sample.szproject');
                    if (sampleRes.ok) {
                        const blob = await sampleRes.blob();
                        const file = new File([blob], "signalzero_sample.szproject", { type: "application/zip" });
                        await projectService.import(file);
                    } else {
                        console.warn("Failed to fetch sample project");
                    }
                } catch (e) {
                    console.error("Failed to load sample project", e);
                    // Non-blocking error, just log it
                }
            }

            onSetupComplete(data.token, data.user);
        } catch (err: any) {
            setError(err.message || String(err));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-6">
            <div className="max-w-4xl w-full bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 overflow-hidden flex flex-col md:flex-row">
                
                {/* Sidebar / Info */}
                <div className="bg-emerald-900 text-white p-8 md:w-1/3 flex flex-col justify-between">
                    <div>
                        <div className="w-12 h-12 bg-emerald-800 rounded-xl flex items-center justify-center mb-6">
                            <Shield size={24} className="text-emerald-400" />
                        </div>
                        <h2 className="text-2xl font-bold font-mono mb-4">System Initialization</h2>
                        <p className="text-emerald-200 text-sm leading-relaxed mb-6 font-mono">
                            Welcome to SignalZero. Please configure your administrative credentials and primary inference provider to begin.
                        </p>
                        <div className="space-y-4">
                            <div className="flex items-center gap-3 text-xs font-mono text-emerald-300">
                                <div className={`w-6 h-6 rounded-full flex items-center justify-center ${licenseAccepted ? 'bg-emerald-500 text-white' : 'bg-emerald-800'}`}>1</div>
                                <span>Accept License</span>
                            </div>
                            <div className="flex items-center gap-3 text-xs font-mono text-emerald-300">
                                <div className={`w-6 h-6 rounded-full flex items-center justify-center ${username && password ? 'bg-emerald-500 text-white' : 'bg-emerald-800'}`}>2</div>
                                <span>Secure Admin Account</span>
                            </div>
                            <div className="flex items-center gap-3 text-xs font-mono text-emerald-300">
                                <div className="w-6 h-6 rounded-full bg-emerald-800 flex items-center justify-center">3</div>
                                <span>Configure AI Model</span>
                            </div>
                        </div>
                    </div>
                    <div className="mt-8 text-xs text-emerald-400 font-mono">
                        v2.0.0 Setup Wizard
                    </div>
                </div>

                {/* Form */}
                <div className="p-8 md:w-2/3 overflow-y-auto max-h-[90vh]">
                    <div className="space-y-8">
                        
                        {error && (
                            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-sm font-mono">
                                {error}
                            </div>
                        )}

                        {/* License Section */}
                        <section className="space-y-4">
                            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-500 font-mono border-b border-gray-200 dark:border-gray-800 pb-2 flex items-center gap-2">
                                <FileText size={16}/> License Agreement
                            </h3>
                            <div className="p-4 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg text-xs text-gray-600 dark:text-gray-400 font-mono h-32 overflow-y-auto leading-relaxed">
                                <p className="font-bold mb-2">Creative Commons Attribution-NonCommercial 4.0 International License</p>
                                <p className="mb-2">
                                    Commercial use of this software is strictly prohibited under this license. 
                                    To obtain a license for commercial use, please contact: <span className="text-emerald-600 dark:text-emerald-400">klietus@gmail.com</span>
                                </p>
                                <p>
                                    By exercising the Licensed Rights, You accept and agree to be bound by the terms and conditions of this Creative Commons Attribution-NonCommercial 4.0 International Public License ("Public License"). To the extent this Public License may be interpreted as a contract, You are granted the Licensed Rights in consideration of Your acceptance of these terms and conditions.
                                </p>
                            </div>
                            <div className="flex items-center gap-3">
                                <input
                                    type="checkbox"
                                    id="acceptLicense"
                                    checked={licenseAccepted}
                                    onChange={(e) => setLicenseAccepted(e.target.checked)}
                                    className="w-4 h-4 text-emerald-600 rounded border-gray-300 focus:ring-emerald-500"
                                />
                                <label htmlFor="acceptLicense" className="text-sm font-mono text-gray-700 dark:text-gray-300 cursor-pointer select-none">
                                    I accept the terms of the license agreement
                                </label>
                            </div>
                        </section>

                        {/* Admin User */}
                        <section className={`space-y-4 transition-opacity duration-200 ${!licenseAccepted ? 'opacity-50 pointer-events-none' : ''}`}>
                            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-500 font-mono border-b border-gray-200 dark:border-gray-800 pb-2">
                                Administrative User
                            </h3>
                            <div className="space-y-3">
                                <div>
                                    <label className="text-xs font-bold text-gray-600 dark:text-gray-400 font-mono block mb-1">Username</label>
                                    <input 
                                        type="text" 
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        className="w-full bg-gray-100 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs font-bold text-gray-600 dark:text-gray-400 font-mono block mb-1">Password</label>
                                        <input 
                                            type="password" 
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            className="w-full bg-gray-100 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-600 dark:text-gray-400 font-mono block mb-1">Confirm Password</label>
                                        <input 
                                            type="password" 
                                            value={confirmPassword}
                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                            className="w-full bg-gray-100 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                                        />
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Search Configuration */}
                        <section className={`space-y-4 transition-opacity duration-200 ${!licenseAccepted ? 'opacity-50 pointer-events-none' : ''}`}>
                            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-500 font-mono border-b border-gray-200 dark:border-gray-800 pb-2">
                                Search Engine Configuration
                            </h3>
                            <div className="space-y-3">
                                <div className="pt-2">
                                    <label className="text-xs font-bold text-gray-600 dark:text-gray-400 font-mono block mb-1 flex items-center gap-2">
                                        <Search size={12} className="text-emerald-500"/> SerpApi Key (Recommended)
                                    </label>
                                    <input 
                                        type="password" 
                                        value={serpApiKey}
                                        onChange={(e) => setSerpApiKey(e.target.value)}
                                        placeholder="Optional"
                                        className="w-full bg-gray-100 dark:bg-gray-950 border border-emerald-200 dark:border-emerald-800 rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                                    />
                                    <p className="text-[10px] text-gray-500 mt-1">SerpApi is recommended for superior search results.</p>
                                </div>
                            </div>
                        </section>

                        {/* Sample Project */}
                        <div className={`flex items-center gap-3 p-4 bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/30 rounded-lg transition-opacity duration-200 ${!licenseAccepted ? 'opacity-50 pointer-events-none' : ''}`}>
                            <input
                                type="checkbox"
                                id="loadSample"
                                checked={loadSample}
                                onChange={(e) => setLoadSample(e.target.checked)}
                                className="w-4 h-4 text-emerald-600 rounded border-gray-300 focus:ring-emerald-500"
                            />
                            <label htmlFor="loadSample" className="text-sm font-mono text-gray-700 dark:text-gray-300 cursor-pointer select-none">
                                Load SignalZero Sample Project
                            </label>
                        </div>

                        {/* Inference Config */}
                        <section className={`space-y-4 transition-opacity duration-200 ${!licenseAccepted ? 'opacity-50 pointer-events-none' : ''}`}>
                            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-500 font-mono border-b border-gray-200 dark:border-gray-800 pb-2">
                                AI Model Configuration
                            </h3>
                            
                            <div className="flex gap-2 mb-4">
                                <button
                                    onClick={() => handleProviderChange('local')}
                                    className={`flex-1 py-2 rounded text-xs font-bold font-mono border transition-all ${inferenceProvider === 'local' ? 'bg-emerald-50 border-emerald-500 text-emerald-700' : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'}`}
                                >
                                    Local (Llama 3)
                                </button>
                                <button
                                    onClick={() => handleProviderChange('openai')}
                                    className={`flex-1 py-2 rounded text-xs font-bold font-mono border transition-all ${inferenceProvider === 'openai' ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'}`}
                                >
                                    OpenAI
                                </button>
                                <button
                                    onClick={() => handleProviderChange('gemini')}
                                    className={`flex-1 py-2 rounded text-xs font-bold font-mono border transition-all ${inferenceProvider === 'gemini' ? 'bg-blue-50 border-blue-500 text-blue-700' : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'}`}
                                >
                                    Gemini
                                </button>
                                <button
                                    onClick={() => handleProviderChange('kimi2')}
                                    className={`flex-1 py-2 rounded text-xs font-bold font-mono border transition-all ${inferenceProvider === 'kimi2' ? 'bg-purple-50 border-purple-500 text-purple-700' : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'}`}
                                >
                                    Kimi
                                </button>
                            </div>

                            <div className="space-y-3">
                                {inferenceProvider !== 'local' && (
                                    <div className="animate-in fade-in">
                                        <label className="text-xs font-bold text-gray-600 dark:text-gray-400 font-mono block mb-1">API Key</label>
                                        <input 
                                            type="password" 
                                            value={inferenceApiKey}
                                            onChange={(e) => setInferenceApiKey(e.target.value)}
                                            placeholder={`Enter ${inferenceProvider} API Key`}
                                            className="w-full bg-gray-100 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                                        />
                                    </div>
                                )}
                                
                                <div className="space-y-3">
                                    <label className="text-xs font-bold text-gray-600 dark:text-gray-400 font-mono block mb-1">Inference Endpoint</label>
                                    <input 
                                        type="text" 
                                        value={inferenceEndpoint}
                                        onChange={(e) => setInferenceEndpoint(e.target.value)}
                                        placeholder="e.g. http://localhost:1234/v1"
                                        className="w-full bg-gray-100 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4 mt-3">
                                    <div>
                                        <label className="text-xs font-bold text-gray-600 dark:text-gray-400 font-mono block mb-1">Chat Model Name</label>
                                        <input 
                                            type="text" 
                                            value={inferenceModel}
                                            onChange={(e) => setInferenceModel(e.target.value)}
                                            placeholder="e.g. gpt-4-turbo-preview"
                                            className="w-full bg-gray-100 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-600 dark:text-gray-400 font-mono block mb-1">Fast Model Name</label>
                                        <input 
                                            type="text" 
                                            value={inferenceFastModel}
                                            onChange={(e) => setInferenceFastModel(e.target.value)}
                                            placeholder="e.g. gpt-4o-mini"
                                            className="w-full bg-gray-100 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                                        />
                                    </div>
                                </div>
                                <p className="text-[10px] text-gray-500 mt-1">
                                    <span className="font-bold text-amber-600 dark:text-amber-500 uppercase mr-1">Note:</span> 
                                    Smaller models (e.g. &lt;10B) will produce faster traces but may be less accurate. Fast models can be very small (e.g. 0.8B) for optimal performance.
                                </p>
                            </div>
                        </section>

                        <div className="pt-6">
                            <button
                                onClick={handleSetup}
                                disabled={loading || !licenseAccepted}
                                className={`w-full font-bold py-3 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 font-mono ${
                                    loading || !licenseAccepted
                                        ? 'bg-gray-300 dark:bg-gray-800 text-gray-500 cursor-not-allowed shadow-none'
                                        : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20 active:scale-95'
                                }`}
                            >
                                {loading ? <Loader2 size={18} className="animate-spin" /> : <><Save size={18} /> Initialize System</>}
                            </button>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
};
