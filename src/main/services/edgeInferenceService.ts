import { pipeline, env } from '@huggingface/transformers';
import { loggerService, LogCategory } from './loggerService.js';
import { app } from 'electron';
import path from 'path';

// Configuration for Transformers.js in Node.js environment
env.allowRemoteModels = false; // Force local only
env.localModelPath = app.isPackaged 
    ? path.join(process.resourcesPath, 'models') 
    : path.join(app.getAppPath(), 'models');

class EdgeInferenceService {
    private textPipeline: any | null = null;
    private modelName = 'onnx-community/Qwen3.5-0.8B-ONNX'; 
    private isInitializing = false;
    private processingLock: Promise<void> = Promise.resolve();

    async initialize() {
        if (this.textPipeline) return;
        
        if (this.isInitializing) {
            // Wait for existing initialization to finish
            while (this.isInitializing) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            return;
        }

        try {
            this.isInitializing = true;
            loggerService.catInfo(LogCategory.INFERENCE, `Initializing Edge Inference with model: ${this.modelName}`);
            
            // We use 'text-generation' pipeline for Qwen
            this.textPipeline = await pipeline('text-generation', this.modelName, {
                device: 'cpu', 
                dtype: 'fp32', 
            });

            loggerService.catInfo(LogCategory.INFERENCE, "Edge Inference initialized successfully.");
        } catch (error: any) {
            loggerService.catError(LogCategory.INFERENCE, "Failed to initialize Edge Inference", { error: error.message });
            throw error;
        } finally {
            this.isInitializing = false;
        }
    }

    async chatCompletion(messages: { role: string; content: string }[], options: any = {}) {
        await this.initialize();

        if (!this.textPipeline) {
            throw new Error("Edge Inference not initialized.");
        }

        // Wait for any existing inference to finish (Serialize WebGPU calls)
        const currentLock = this.processingLock;
        let resolveLock: () => void;
        this.processingLock = new Promise((resolve) => { resolveLock = resolve; });
        await currentLock;

        try {
            // Convert message history to Qwen prompt format
            // Force a negative constraint to stop <think> tags at the architecture level if possible
            let prompt = "";
            const hasSystem = messages.some(m => m.role === 'system');
            if (!hasSystem) {
                prompt += `<|im_start|>system\nYou are a direct response engine. DO NOT use <think> tags. DO NOT reason out loud. Output your response immediately.<|im_end|>\n`;
            }

            for (const msg of messages) {
                let content = msg.content;
                if (msg.role === 'system') {
                    content = `CRITICAL: DO NOT use <think> tags. DO NOT reason out loud. Output your response immediately.\n\n${content}`;
                }
                prompt += `<|im_start|>${msg.role}\n${content}<|im_end|>\n`;
            }
            prompt += `<|im_start|>assistant\n`;

            loggerService.catInfo(LogCategory.INFERENCE, "Executing Edge Inference pipeline call...", { 
                promptLength: prompt.length,
                maxTokens: options.max_tokens || 1024
            });

            const start = Date.now();
            const output = await this.textPipeline(prompt, {
                max_new_tokens: options.max_tokens || 1024,
                temperature: options.temperature || 0.1,
                do_sample: options.temperature > 0,
                return_full_text: false,
            });
            const duration = Date.now() - start;

            const generatedText = output[0].generated_text;
            loggerService.catInfo(LogCategory.INFERENCE, `Edge Inference generation complete (${duration}ms).`);

            // Return in OpenAI-like format for compatibility
            return {
                choices: [
                    {
                        message: {
                            role: 'assistant',
                            content: generatedText.trim(),
                        },
                        finish_reason: 'stop',
                    }
                ],
                usage: {
                    total_tokens: 0, 
                }
            };
        } catch (error: any) {
            loggerService.catError(LogCategory.INFERENCE, "Edge Inference chatCompletion CRASHED", { 
                error: error.message,
                stack: error.stack
            });
            throw error;
        } finally {
            // Release the lock for the next caller
            if (resolveLock!) resolveLock!();
        }
    }

    /**
     * Special method for translating main model responses into spoken dialogue format.
     */
    async translateForVoice(text: string): Promise<string> {
        const prompt = [
            { 
                role: 'system', 
                content: 'You are a voice assistant. Rewrite the following text to be concise, natural-sounding, and suitable for text-to-speech. Remove markdown, bullet points, and complex formatting. Keep the core meaning. CRITICAL: DO NOT use <think> tags. DO NOT reason out loud.' 
            },
            { role: 'user', content: text }
        ];

        const result = await this.chatCompletion(prompt, { max_tokens: 256, temperature: 0.3 });
        return result.choices[0].message.content;
    }
}

export const edgeInferenceService = new EdgeInferenceService();
