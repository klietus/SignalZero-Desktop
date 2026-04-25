import { spawn, ChildProcess } from 'child_process';
import { loggerService, LogCategory } from './loggerService.js';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';

export enum LlamaPriority {
    LOW = 0,
    MEDIUM = 5,
    HIGH = 10,
    URGENT = 20
}

export class LlamaSidecarInstance extends EventEmitter {
    private process: ChildProcess | null = null;
    private isInitializing = false;
    private queue: any = null;

    constructor(
        private name: string,
        private port: number,
        private concurrency: number = 1
    ) {
        super();
    }

    async initialize() {
        if (this.process || this.isInitializing) return;
        this.isInitializing = true;

        try {
            if (!this.queue) {
                const PQueue = (await import('p-queue')).default;
                this.queue = new PQueue({ concurrency: this.concurrency });
            }

            const projectRoot = app.getAppPath();
            const modelPath = path.join(projectRoot, 'models', 'Qwen3.5-0.8B-Q8_0.gguf');
            const mmprojPath = path.join(projectRoot, 'models', 'mmproj-Qwen3.5-0.8B-BF16.gguf');

            if (!fs.existsSync(modelPath)) {
                loggerService.catError(LogCategory.SYSTEM, `Llama [${this.name}]: Model NOT FOUND at ${modelPath}`);
                this.isInitializing = false;
                return;
            }

            const llamaExe = '/opt/homebrew/bin/llama-server';
            if (!fs.existsSync(llamaExe)) {
                loggerService.catError(LogCategory.SYSTEM, `Llama [${this.name}]: llama-server NOT FOUND at ${llamaExe}`);
                this.isInitializing = false;
                return;
            }

            const args = [
                '-m', modelPath,
                '--mmproj', mmprojPath,
                '--port', this.port.toString(),
                '-ngl', '99',       // GPU Offload
                '-t', '8',         // Threads
                '-c', '65536',     // 64k Context size
                '--cache-type-k', 'q8_0',
                '--cache-type-v', 'q8_0',
                '--no-mmap',
                '-fa', 'on'
            ];

            loggerService.catInfo(LogCategory.SYSTEM, `Launching Llama [${this.name}]`, { port: this.port, concurrency: this.concurrency });

            this.process = spawn(llamaExe, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                    GGML_METAL_PATH_RESOURCES: '/opt/homebrew/share/llama.cpp'
                }
            });

            this.process.stderr?.on('data', (data) => {
                const msg = data.toString().trim();
                if (msg && (msg.includes('error') || msg.includes('FAIL'))) {
                    loggerService.catError(LogCategory.SYSTEM, `Llama [${this.name}]: ${msg}`);
                }
            });

            this.process.on('exit', (code, _signal) => {
                this.process = null;
                this.isInitializing = false;
                loggerService.catError(LogCategory.SYSTEM, `Llama [${this.name}] exited with code ${code}`);
            });

            // Health Check
            let attempts = 0;
            while (attempts < 30) {
                try {
                    const resp = await fetch(`http://localhost:${this.port}/health`);
                    if (resp.ok) {
                        loggerService.catInfo(LogCategory.SYSTEM, `Llama [${this.name}] is ready.`);
                        break;
                    }
                } catch (e) { }
                await new Promise(r => setTimeout(r, 1000));
                attempts++;
            }

            this.isInitializing = false;
        } catch (err: any) {
            this.isInitializing = false;
            loggerService.catError(LogCategory.SYSTEM, `Failed to launch Llama [${this.name}]: ${err.message}`);
        }
    }

    async completion(prompt: string, options: any = {}) {
        if (!this.queue) {
            const PQueue = (await import('p-queue')).default;
            this.queue = new PQueue({ concurrency: this.concurrency });
        }

        const priority = options.priority !== undefined ? options.priority : LlamaPriority.LOW;

        return this.queue.add(async () => {
            const body: any = {
                prompt,
                n_predict: options.maxTokens || options.n_predict || 2048,
                stream: false,
                cache_prompt: true,
                ...options
            };

            delete body.maxTokens;
            delete body.priority;

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
                throw new Error(`Llama [${this.name}] failed: ${resp.statusText} - ${errorText}`);
            }

            const json = await resp.json();
            loggerService.catDebug(LogCategory.SYSTEM, `Llama [${this.name}] Raw Response`, {
                promptLength: prompt.length,
                responseLength: json.content?.length || 0,
                priority
            });
            return json;
        }, { priority });
    }

    stop() {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
    }
}

// Export specialized instances
export const llamaService = new LlamaSidecarInstance('Standard', 8080, 4);
export const urgentLlamaService = new LlamaSidecarInstance('Urgent', 8081, 1);
