import { spawn, ChildProcess } from 'child_process';
import { loggerService, LogCategory } from './loggerService.js';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';

class LlamaService extends EventEmitter {
    private process: ChildProcess | null = null;
    private isInitializing = false;
    private port = 8080;
    private limit: any = null;

    async initialize() {
        if (this.process || this.isInitializing) return;
        this.isInitializing = true;

        try {
            if (!this.limit) {
                const pLimit = (await import('p-limit')).default;
                this.limit = pLimit(4); // Default concurrency for small model on Apple Silicon
            }

            const projectRoot = app.getAppPath();
            const modelPath = path.join(projectRoot, 'models', 'Qwen3.5-2B-Q4_K_M.gguf');
            const mmprojPath = path.join(projectRoot, 'models', 'mmproj-Qwen3.5-2B-BF16.gguf');

            // Check if model exists
            if (!fs.existsSync(modelPath)) {
                loggerService.catError(LogCategory.SYSTEM, `Llama Sidecar: Model NOT FOUND at ${modelPath}. Run sidecars/llama/setup.sh first.`);
                this.isInitializing = false;
                return;
            }

            // llama-server is in /opt/homebrew/bin/llama-server
            const llamaExe = '/opt/homebrew/bin/llama-server';

            if (!fs.existsSync(llamaExe)) {
                loggerService.catError(LogCategory.SYSTEM, `Llama Sidecar: llama-server NOT FOUND at ${llamaExe}. Please install via 'brew install llama.cpp'.`);
                this.isInitializing = false;
                return;
            }

            const args = [
                '-m', modelPath,
                '--mmproj', mmprojPath,
                '--port', this.port.toString(),
                '-ngl', '99',       // Offload all layers to GPU (Metal)
                '-t', '8',         // Threads
                '-c', '32768',     // 32k Context size
                '--no-mmap',       // Sometimes faster on Apple Silicon
                '-fa', 'on'        // Flash Attention
            ];

            loggerService.catInfo(LogCategory.SYSTEM, `Launching Llama Sidecar`, { llamaExe, model: modelPath, port: this.port });

            this.process = spawn(llamaExe, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                    GGML_METAL_PATH_RESOURCES: '/opt/homebrew/share/llama.cpp'
                }
            });

            this.process.stdout?.on('data', (data) => {
                const msg = data.toString().trim();
                if (msg) loggerService.catDebug(LogCategory.SYSTEM, `Llama Sidecar: ${msg}`);
            });

            this.process.stderr?.on('data', (data) => {
                const msg = data.toString().trim();
                if (msg) {
                    if (msg.includes('error') || msg.includes('FAIL')) {
                        loggerService.catError(LogCategory.SYSTEM, `Llama Sidecar: ${msg}`);
                    } else {
                        loggerService.catInfo(LogCategory.SYSTEM, `Llama Sidecar: ${msg}`);
                    }
                }
            });

            this.process.on('exit', (code, signal) => {
                this.process = null;
                this.isInitializing = false;
                loggerService.catError(LogCategory.SYSTEM, `Llama Sidecar exited with code ${code} and signal ${signal}`);
            });

            // Wait for server to be ready
            let attempts = 0;
            const maxAttempts = 30;
            while (attempts < maxAttempts) {
                try {
                    const resp = await fetch(`http://localhost:${this.port}/health`);
                    if (resp.ok) {
                        loggerService.catInfo(LogCategory.SYSTEM, "Llama Sidecar is ready.");
                        break;
                    }
                } catch (e) {
                    // Not ready yet
                }
                await new Promise(r => setTimeout(r, 1000));
                attempts++;
            }

            if (attempts === maxAttempts) {
                loggerService.catError(LogCategory.SYSTEM, "Llama Sidecar failed to start within timeout.");
            }

            this.isInitializing = false;
        } catch (err: any) {
            this.isInitializing = false;
            loggerService.catError(LogCategory.SYSTEM, `Failed to launch Llama Sidecar: ${err.message}`);
        }
    }

    async completion(prompt: string, options: any = {}) {
        if (!this.limit) {
            const pLimit = (await import('p-limit')).default;
            this.limit = pLimit(4);
        }
        return this.limit(async () => {
            const body: any = {
                prompt,
                n_predict: options.maxTokens || options.n_predict || 1024,
                stream: false,
                ...options
            };

            // Remove maxTokens if it exists to avoid confusion in llama-server
            delete body.maxTokens;

            // Handle images for multimodal support
            if (options.images && options.images.length > 0) {
                body.image_data = options.images.map((img: any) => ({
                    data: img.base64,
                    id: img.id || 0
                }));
            }

            const resp = await fetch(`http://localhost:${this.port}/completion`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!resp.ok) {
                const errorText = await resp.text();
                throw new Error(`Llama completion failed: ${resp.statusText} - ${errorText}`);
            }

            const json = await resp.json();
            loggerService.catDebug(LogCategory.SYSTEM, "Llama Sidecar Raw Response", { 
                promptLength: prompt.length, 
                responseLength: json.content?.length || 0,
                firstChars: json.content?.substring(0, 100)
            });
            return json;
        });
    }

    stop() {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
    }
}

export const llamaService = new LlamaService();
