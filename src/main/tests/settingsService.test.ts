import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { settingsService } from '../services/settingsService.js';
import { safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

describe('SettingsService with safeStorage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        const settingsFile = path.join(app.getPath('userData'), 'settings.json');
        if (fs.existsSync(settingsFile)) {
            fs.unlinkSync(settingsFile);
        }
    });

    it('should encrypt API keys when saving', async () => {
        const encryptSpy = vi.spyOn(safeStorage, 'encryptString');
        
        await settingsService.setInferenceSettings({
            provider: 'openai',
            apiKey: 'secret-key-123',
            endpoint: 'https://api.openai.com/v1',
            model: 'gpt-4',
            agentModel: 'gpt-4',
            visionModel: 'gpt-4-v',
            fastModel: 'gpt-3.5'
        });

        expect(encryptSpy).toHaveBeenCalledWith('secret-key-123');
        
        // Verify disk content is NOT plain text
        const settingsFile = path.join(app.getPath('userData'), 'settings.json');
        const onDisk = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
        expect(onDisk.inference.apiKey).not.toBe('secret-key-123');
    });

    it('should decrypt API keys when retrieving', async () => {
        const decryptSpy = vi.spyOn(safeStorage, 'decryptString');
        
        await settingsService.setInferenceSettings({
            provider: 'openai',
            apiKey: 'secret-key-123',
            endpoint: '...',
            model: '...',
            agentModel: '...',
            visionModel: '...',
            fastModel: '...'
        });

        const retrieved = await settingsService.getInferenceSettings();
        expect(decryptSpy).toHaveBeenCalled();
        expect(retrieved.apiKey).toBe('secret-key-123');
    });

    it('should handle SerpApi encryption', async () => {
        await settingsService.setSerpApiSettings({ apiKey: 'serp-secret' });
        
        const retrieved = await settingsService.getSerpApiSettings();
        expect(retrieved.apiKey).toBe('serp-secret');
        
        const onDisk = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8'));
        expect(onDisk.serpApi.apiKey).not.toBe('serp-secret');
    });
});
