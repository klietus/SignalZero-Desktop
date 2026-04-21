import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { llamaService } from '../services/llamaService.js';
import fs from 'fs';
import path from 'path';

describe('Llama Sidecar Integration', () => {
    // This test requires llama-server to be installed via brew 
    // and the model to be linked via sidecars/llama/setup.sh
    
    const projectRoot = '/Users/klietus/workspace/LocalNode/SignalZero-Desktop';
    const modelPath = path.join(projectRoot, 'models', 'Qwen3.5-2B-Q4_K_M.gguf');

    it('should have the model file present', () => {
        expect(fs.existsSync(modelPath)).toBe(true);
    });

    it('should initialize the sidecar and respond to completion', async () => {
        // Increase timeout for model loading
        await llamaService.initialize();
        
        try {
            const prompt = "The capital of France is";
            const result = await llamaService.completion(prompt, { maxTokens: 10 });
            
            console.log("Llama Sidecar Response:", result.content);
            
            expect(result).toBeDefined();
            expect(result.content).toBeDefined();
            expect(result.content.toLowerCase()).toContain('paris');
        } finally {
            llamaService.stop();
        }
    }, 60000); // 60s timeout
});
