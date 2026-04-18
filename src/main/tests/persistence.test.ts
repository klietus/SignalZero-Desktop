import { describe, it, expect, vi, beforeEach } from 'vitest';
import { settingsService } from '../services/settingsService.js';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

describe('Settings Persistence', () => {
    it('should save and retrieve voice profiles from disk at top-level', async () => {
        // 1. Setup
        await settingsService.initialize();
        const settingsPath = path.join(app.getPath('userData'), 'settings.json');
        
        // 2. Create dummy profile
        const dummyName = "test-user-" + Date.now();
        const dummyEmbedding = Array.from({length: 192}, () => Math.random());
        const dummyProfiles = { [dummyName]: dummyEmbedding };

        // 3. Perform update (using top-level property)
        await settingsService.update({
            voiceProfiles: dummyProfiles
        } as any);

        // 4. Inspect Disk
        const fileContent = fs.readFileSync(settingsPath, 'utf-8');
        const diskContent = JSON.parse(fileContent);
        
        // Verify it is at TOP LEVEL now
        const diskProfiles = diskContent.voiceProfiles || {};
        
        expect(diskProfiles[dummyName]).toBeDefined();
        expect(diskProfiles[dummyName]).toEqual(dummyEmbedding);

        // 5. Verify Retrieval
        // @ts-ignore - clear private cache for test
        (settingsService as any)._settingsCache = null; 
        
        const retrievedSettings = await settingsService.get();
        expect(retrievedSettings.voiceProfiles).toBeDefined();
        expect(retrievedSettings.voiceProfiles![dummyName]).toEqual(dummyEmbedding);
    });
});
