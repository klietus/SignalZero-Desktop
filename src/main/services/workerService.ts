import { embedTextsWithModelPath } from './embeddingService.js';
import { app } from 'electron';
import path from 'path';

// Embedding serialization — onnxruntime-node crashes with concurrent calls
let embeddingInFlight = false;

async function runEmbedding(texts: string[]): Promise<number[][]> {
    while (embeddingInFlight) {
        await new Promise(r => setTimeout(r, 50));
    }
    embeddingInFlight = true;
    try {
        const modelPath = app.isPackaged 
            ? path.join(process.resourcesPath, 'models') 
            : path.join(app.getAppPath(), 'models');
        return await embedTextsWithModelPath(texts, modelPath);
    } finally {
        embeddingInFlight = false;
    }
}

export const workerService = {
    async embedTexts(texts: string[]): Promise<number[][]> {
        if (!texts || texts.length === 0) return [];
        return runEmbedding(texts);
    }
};
