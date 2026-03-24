import { getApiUrl } from './config';
import { logger } from './logger';

const getHeaders = () => {
    const token = localStorage.getItem('signalzero_auth_token') || '';
    return {
        'Content-Type': 'application/json',
        'x-auth-token': token
    };
};

export interface User {
    id: string;
    username: string;
    role: 'admin' | 'user';
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
    apiKey?: string;
}

export interface CreateUserRequest {
    username: string;
    password: string;
    role?: 'admin' | 'user';
}

export interface UpdateUserRequest {
    username?: string;
    password?: string;
    role?: 'admin' | 'user';
    enabled?: boolean;
}

const apiFetch = async (path: string, options: RequestInit = {}) => {
    const url = `${getApiUrl()}${path}`;
    const response = await fetch(url, {
        ...options,
        headers: {
            ...getHeaders(),
            ...options.headers
        }
    });
    
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || `HTTP ${response.status}`);
    }
    
    return response;
};

export const userService = {
    /**
     * Get list of all users (admin only)
     */
    listUsers: async (): Promise<User[]> => {
        const resp = await apiFetch('/users');
        const data = await resp.json();
        return data.users || [];
    },

    /**
     * Get current user info
     */
    getCurrentUser: async (): Promise<User> => {
        const resp = await apiFetch('/users/me');
        return await resp.json();
    },

    /**
     * Create a new user (admin only)
     */
    createUser: async (request: CreateUserRequest): Promise<User> => {
        const resp = await apiFetch('/users', {
            method: 'POST',
            body: JSON.stringify(request)
        });
        return await resp.json();
    },

    /**
     * Update a user
     */
    updateUser: async (userId: string, request: UpdateUserRequest): Promise<User> => {
        const resp = await apiFetch(`/users/${userId}`, {
            method: 'PATCH',
            body: JSON.stringify(request)
        });
        return await resp.json();
    },

    /**
     * Delete a user (admin only)
     */
    deleteUser: async (userId: string): Promise<void> => {
        await apiFetch(`/users/${userId}`, {
            method: 'DELETE'
        });
    },

    /**
     * Regenerate API key for a user
     */
    regenerateApiKey: async (userId: string): Promise<string> => {
        const resp = await apiFetch(`/users/${userId}/apikey`, {
            method: 'POST'
        });
        const data = await resp.json();
        return data.apiKey;
    },

    /**
     * Copy API key to clipboard
     */
    copyApiKey: (apiKey: string): void => {
        navigator.clipboard.writeText(apiKey).then(() => {
            logger.info('USER', 'API key copied to clipboard');
        }).catch(err => {
            logger.error('USER', 'Failed to copy API key', err);
        });
    }
};
