import React, { useState } from 'react';
import { Lock, Loader2 } from 'lucide-react';
import { apiFetch } from '../../services/api';

interface LoginScreenProps {
    onLoginSuccess: (token: string, user: any) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const res = await apiFetch('/auth/login', {
                method: 'POST',
                body: JSON.stringify({ username, password })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Login failed');
            }

            const data = await res.json();
            localStorage.setItem('signalzero_auth_token', data.token);
            onLoginSuccess(data.token, data.user);
        } catch (err: any) {
            setError(err.message || String(err));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
            <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                <div className="p-8">
                    <div className="flex justify-center mb-6">
                        <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 rounded-2xl flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                             <Lock size={32} />
                        </div>
                    </div>
                    
                    <h2 className="text-2xl font-bold text-center text-gray-900 dark:text-white mb-2 font-mono">SignalZero Kernel</h2>
                    <p className="text-center text-gray-500 text-sm mb-8 font-mono">Restricted Access</p>

                    {error && (
                        <div className="mb-6 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-xs font-mono">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleLogin} className="space-y-4">
                        <div className="space-y-1">
                            <label className="text-xs font-bold uppercase text-gray-500 font-mono">Username</label>
                            <input 
                                type="text" 
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="w-full bg-gray-100 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none font-mono"
                                autoFocus
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-bold uppercase text-gray-500 font-mono">Password</label>
                            <input 
                                type="password" 
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-gray-100 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none font-mono"
                            />
                        </div>

                        <button 
                            type="submit"
                            disabled={loading}
                            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-lg transition-colors font-mono flex items-center justify-center gap-2 mt-4"
                        >
                            {loading ? <Loader2 size={16} className="animate-spin" /> : 'Authenticate'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};
