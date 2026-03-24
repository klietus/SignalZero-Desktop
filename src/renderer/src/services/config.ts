
export const DEFAULT_API_URL = 'http://localhost:3001/api';
const API_URL_KEY = 'signalzero_api_url';

export const getApiUrl = () => {
    return localStorage.getItem(API_URL_KEY) || DEFAULT_API_URL;
};

export const setApiUrl = (url: string) => {
    let clean = url.trim();
    while (clean.endsWith('/')) {
        clean = clean.slice(0, -1);
    }
    localStorage.setItem(API_URL_KEY, clean);
};

export const isApiUrlConfigured = () => {
    return localStorage.getItem(API_URL_KEY) !== null;
};

export const validateApiConnection = async (url?: string): Promise<boolean> => {
    const target = url || getApiUrl();
    try {
        const res = await fetch(`${target}/health`);
        return res.ok;
    } catch (e) {
        // Fallback to checking /domains if /health isn't implemented
        try {
             const res2 = await fetch(`${target}/domains`);
             return res2.ok;
        } catch {
             return false;
        }
    }
};
