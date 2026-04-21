import { describe, it, expect, beforeEach, vi } from 'vitest';
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
            agentModel: 'gpt-4'
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
            agentModel: '...'
        });

        const retrieved = await settingsService.getInferenceSettings();
        expect(decryptSpy).toHaveBeenCalled();
        expect(retrieved.apiKey).toBe('secret-key-123');
    });

    it('should handle SerpApi encryption', async () => {
        await settingsService.setSerpApiSettings({ apiKey: 'serp-secret', enabled: true });
        
        const retrieved = await settingsService.getSerpApiSettings();
        expect(retrieved.apiKey).toBe('serp-secret');
        expect(retrieved.enabled).toBe(true);
        
        const onDisk = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8'));
        expect(onDisk.serpApi.apiKey).not.toBe('serp-secret');
    });

    it('should handle Brave Search encryption', async () => {
        await settingsService.setBraveSearchSettings({ apiKey: 'brave-secret', enabled: true });
        
        const retrieved = await settingsService.getBraveSearchSettings();
        expect(retrieved.apiKey).toBe('brave-secret');
        expect(retrieved.enabled).toBe(true);
        
        const onDisk = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8'));
        expect(onDisk.braveSearch.apiKey).not.toBe('brave-secret');
    });

    it('should handle Tavily encryption', async () => {
        await settingsService.setTavilySettings({ apiKey: 'tavily-secret', enabled: false });
        
        const retrieved = await settingsService.getTavilySettings();
        expect(retrieved.apiKey).toBe('tavily-secret');
        expect(retrieved.enabled).toBe(false);
        
        const onDisk = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8'));
        expect(onDisk.tavily.apiKey).not.toBe('tavily-secret');
    });
});
