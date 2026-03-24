import { getApiUrl } from './config';
import { logger } from './logger';

export const getHeaders = () => {
    const token = localStorage.getItem('signalzero_auth_token') || '';
    return {
        'Content-Type': 'application/json',
        'x-auth-token': token
    };
};

interface ApiOptions extends RequestInit {
    skipLog?: boolean;
}

export const apiFetch = async (path: string, options: ApiOptions = {}) => {
    // Ensure path starts with / if not present
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = `${getApiUrl()}${normalizedPath}`;
    const method = options.method || 'GET';
    
    const isHistoryPoll = normalizedPath.includes('/history');

    if (!options.skipLog && !isHistoryPoll) {
        let logBody = options.body;
        if (typeof options.body === 'string') {
            try {
                logBody = JSON.parse(options.body);
            } catch (e) { /* ignore */ }
        }
        
        logger.info('API_REQUEST', `${method} ${normalizedPath}`, { 
            url, 
            method, 
            body: logBody 
        });
    }

    try {
        const start = Date.now();
        const response = await fetch(url, {
            ...options,
            headers: {
                ...getHeaders(),
                ...options.headers
            }
        });
        const duration = Date.now() - start;

        if (response.status === 401 && !normalizedPath.includes('/auth/status')) {
            logger.warn('API_UNAUTHORIZED', `Received 401 from ${normalizedPath}. Redirecting to login.`);
            localStorage.removeItem('signalzero_auth_token');
            // Hard reload to reset App state and trigger auth check
            window.location.reload();
        }

        if (!options.skipLog) {
            const responseClone = response.clone();
            responseClone.text().then(text => {
                let body: any = text;
                try {
                    if (text) body = JSON.parse(text);
                } catch (e) { /* ignore */ }

                const isEmptyHistory = isHistoryPoll && body?.history && Array.isArray(body.history) && body.history.length === 0;

                if (!response.ok) {
                    logger.error('API_RESPONSE_ERROR', `${method} ${normalizedPath} - ${response.status}`, {
                        status: response.status,
                        statusText: response.statusText,
                        duration: `${duration}ms`,
                        url,
                        body
                    });
                } else if (!isEmptyHistory) {
                    logger.info('API_RESPONSE', `${method} ${normalizedPath} - ${response.status}`, {
                        status: response.status,
                        duration: `${duration}ms`,
                        body
                    });
                }
            }).catch(err => {
                 logger.error('API_LOGGING_ERROR', 'Failed to read response body', err);
            });
        }

        return response;
    } catch (error) {
        logger.error('API_NETWORK_ERROR', `${method} ${normalizedPath} - Network Error`, error);
        throw error;
    }
};

export const uploadFile = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    const url = `${getApiUrl()}/upload`;
    // Note: Do NOT set Content-Type header for FormData, fetch does it automatically with boundary
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            body: formData,
             // Explicitly don't merge default JSON headers here
            headers: {
                'x-api-key': localStorage.getItem('signalzero_api_key') || ''
            }
        });

        if (!response.ok) {
            throw new Error(`Upload failed: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        logger.error('API_UPLOAD_ERROR', 'File upload failed', error);
        throw error;
    }
};

export const uploadServiceAccount = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    const url = `${getApiUrl()}/admin/gcp-service-account`;
    const token = localStorage.getItem('signalzero_auth_token') || '';
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            body: formData,
            headers: {
                'x-auth-token': token
            }
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: response.statusText }));
            throw new Error(errorData.error || `Upload failed: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        logger.error('API_UPLOAD_ERROR', 'Service account upload failed', error);
        throw error;
    }
};

export const getMicStatus = async () => {
    const resp = await apiFetch('/voice/mic/status', { skipLog: true });
    if (!resp.ok) throw new Error('Failed to get mic status');
    return await resp.json();
};

export const toggleMic = async (enabled: boolean) => {
    const resp = await apiFetch('/voice/mic/toggle', {
        method: 'POST',
        body: JSON.stringify({ enabled })
    });
    if (!resp.ok) throw new Error('Failed to toggle mic');
    return await resp.json();
};

export const changePassword = async (oldPassword: string, newPassword: string) => {
    const resp = await apiFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ oldPassword, newPassword })
    });
    
    if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({ error: 'Failed to change password' }));
        throw new Error(errorData.error || 'Failed to change password');
    }
    
    return await resp.json();
};