import { apiFetch } from './api';
import { SystemSettings, SystemSettingsUpdate } from '../types';

const SETTINGS_PATH = '/settings';

export const settingsService = {
    async get(): Promise<SystemSettings> {
        const response = await apiFetch(SETTINGS_PATH);
        if (!response.ok) {
            throw new Error(`Failed to load settings: ${response.status}`);
        }
        return response.json();
    },

    async update(payload: SystemSettingsUpdate): Promise<SystemSettings> {
        const response = await apiFetch(SETTINGS_PATH, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const message = await response.text();
            throw new Error(message || 'Failed to update settings');
        }

        return response.json();
    }
};
