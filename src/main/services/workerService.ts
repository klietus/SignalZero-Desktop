import { Worker } from 'worker_threads';
import path from 'path';
import { randomUUID } from 'crypto';
import { app } from 'electron';
import { loggerService, LogCategory } from './loggerService.js';

class WorkerPool {
    private workers: Worker[] = [];
    private queue: { taskId: string, type: string, data: any, resolve: (val: any) => void, reject: (err: any) => void }[] = [];
    private activeTasks = new Map<string, { resolve: (val: any) => void, reject: (err: any) => void }>();
    private maxWorkers = 4; // Capped for stability, typically 1/2 of cores is better for background tasks
    private static instance: WorkerPool;

    constructor() {
        if (WorkerPool.instance) return WorkerPool.instance;
        // Initialize pool
        for (let i = 0; i < this.maxWorkers; i++) {
            this.createNewWorker();
        }
        WorkerPool.instance = this;
    }

    private createNewWorker() {
        const isPackaged = app.isPackaged;
        const workerPath = isPackaged
            ? path.join(process.resourcesPath, 'out/main/heavy_tasks.js')
            : path.join(app.getAppPath(), 'out/main/heavy_tasks.js');
        
        loggerService.catInfo(LogCategory.SYSTEM, `Initializing Worker Thread: ${workerPath}`);
        const worker = new Worker(workerPath);
        
        worker.on('message', (msg) => {
            const { taskId, result, error } = msg;
            const callbacks = this.activeTasks.get(taskId);
            if (callbacks) {
                if (error) callbacks.reject(new Error(error));
                else callbacks.resolve(result);
                this.activeTasks.delete(taskId);
            }
            this.processQueue();
        });

        worker.on('error', (err) => {
            loggerService.catError(LogCategory.SYSTEM, "Worker thread error", { error: err.message });
            this.workers = this.workers.filter(w => w !== worker);
            this.createNewWorker();
        });

        this.workers.push(worker);
    }

    private processQueue() {
        if (this.queue.length === 0) return;
        
        const availableWorker = this.workers.find(w => !this.isWorkerBusy(w));
        if (availableWorker) {
            const task = this.queue.shift();
            if (task) {
                this.activeTasks.set(task.taskId, { resolve: task.resolve, reject: task.reject });
                availableWorker.postMessage({ taskId: task.taskId, type: task.type, data: task.data });
            }
        }
    }

    private isWorkerBusy(_worker: Worker): boolean {
        // Simple check: is this worker's taskId in the activeTasks map?
        // In a real pool we'd track per-worker occupancy.
        return false; // Workers in this simple impl handle one msg at a time via event loop
    }

    async runTask(type: string, data: any): Promise<any> {
        return new Promise((resolve, reject) => {
            const taskId = randomUUID();
            this.queue.push({ taskId, type, data, resolve, reject });
            this.processQueue();
        });
    }

    // Sugar methods
    async parseJson(str: string) { return this.runTask('parseJson', str); }
    async stringifyJson(obj: any) { return this.runTask('stringifyJson', obj); }
    async stripThoughts(text: string) { return this.runTask('stripThoughts', text); }
    
    async embedTexts(texts: string[]) {
        const modelPath = app.isPackaged 
            ? path.join(process.resourcesPath, 'models') 
            : path.join(app.getAppPath(), 'models');
        return this.runTask('embedTexts', { texts, modelPath });
    }
}

export const workerService = new WorkerPool();
