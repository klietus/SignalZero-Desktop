
import React, { useState } from 'react';
import { Server, ArrowRight, Activity, AlertCircle, Loader2 } from 'lucide-react';
import { setApiUrl, DEFAULT_API_URL, validateApiConnection } from '../../services/config';

interface ServerConnectScreenProps {
    onConnect: () => void;
}

export const ServerConnectScreen: React.FC<ServerConnectScreenProps> = ({ onConnect }) => {
    const [url, setUrl] = useState(DEFAULT_API_URL);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleConnect = async () => {
        if (!url) return;
        setIsLoading(true);
        setError(null);

        const isValid = await validateApiConnection(url);
        if (isValid) {
            setApiUrl(url);
            onConnect();
        } else {
            setError("Could not connect to SignalZero Kernel. Check URL and ensure server is running.");
        }
        setIsLoading(false);
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleConnect();
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-950 text-gray-200 p-4 font-mono">
            <div className="max-w-md w-full bg-gray-900 border border-gray-800 rounded-lg shadow-2xl p-8 relative overflow-hidden animate-in fade-in zoom-in-95 duration-500">
                <div className="absolute top-0 left-0 w-full h-1 bg-indigo-500/50"></div>
                 <div className="flex justify-center mb-6">
                     <div className="p-4 bg-gray-950 rounded-full border border-gray-800 text-indigo-500 shadow-inner">
                         <Server size={48} />
                     </div>
                 </div>
                 <h1 className="text-xl font-bold text-center mb-2 tracking-tight">SignalZero Kernel</h1>
                 <p className="text-center text-gray-500 text-xs mb-8 uppercase tracking-widest flex items-center justify-center gap-2">
                    <Activity size={12} className="animate-pulse" />
                    Select Symbolic Host
                 </p>

                 <div className="space-y-6">
                    <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider text-gray-500 font-mono block">Kernel API URL</label>
                        <input
                            value={url}
                            onChange={(e) => { setUrl(e.target.value); setError(null); }}
                            onKeyDown={handleKeyDown}
                            className={`w-full bg-gray-950 border ${error ? 'border-red-500/50' : 'border-gray-800'} rounded-lg p-3 text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none text-white placeholder-gray-700 transition-all`}
                            placeholder="http://localhost:3001/api"
                            autoFocus
                        />
                        {error && (
                            <p className="text-xs text-red-400 flex items-center gap-2 mt-1">
                                <AlertCircle size={12} /> {error}
                            </p>
                        )}
                        <p className="text-[10px] text-gray-600">
                            Enter the address of your running SignalZero Kernel instance.
                        </p>
                    </div>

                    <button
                        onClick={handleConnect}
                        disabled={isLoading}
                        className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-600/50 disabled:cursor-not-allowed text-white rounded-lg transition-all duration-300 text-sm font-mono font-bold flex items-center justify-center gap-2 group shadow-lg shadow-indigo-900/20"
                    >
                        {isLoading ? (
                            <>
                                <Loader2 size={16} className="animate-spin" /> Connecting...
                            </>
                        ) : (
                            <>
                                Connect to Kernel <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform"/>
                            </>
                        )}
                    </button>
                 </div>

                 <div className="mt-8 pt-6 border-t border-gray-800 text-center">
                     <div className="text-[10px] text-gray-600 uppercase tracking-wider">
                         v2.0.1 • Client Interface
                     </div>
                 </div>
            </div>
        </div>
    );
};
