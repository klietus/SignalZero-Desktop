
import { app } from 'electron';
import path from 'path';

let embeddingPipelinePromise: Promise<any> | null = null;

async function getEmbeddingPipeline() {
    if (!embeddingPipelinePromise) {
        embeddingPipelinePromise = (async () => {
            const { pipeline, env } = await import('@huggingface/transformers');
            env.allowRemoteModels = false;
            env.localModelPath = app.isPackaged 
                ? path.join(process.resourcesPath, 'models') 
                : path.join(app.getAppPath(), 'models');
            return pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        })();
    }
    return embeddingPipelinePromise;
}

function tensorToVectors(result: any, fallbackCount: number): number[][] {
    if (!result) return new Array(fallbackCount).fill([]);

    const toList = (value: any): any => {
        if (Array.isArray(value)) return value;
        if (typeof value?.tolist === 'function') return value.tolist();
        return [];
    };

    const list = toList(result);
    if (Array.isArray(list) && list.length > 0 && Array.isArray(list[0])) {
        return list as number[][];
    }

    return [list as number[]];
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];

    const BATCH_SIZE = 32;
    const allVectors: number[][] = [];

    try {
        const embedder = await getEmbeddingPipeline();
        
        for (let i = 0; i < texts.length; i += BATCH_SIZE) {
            const batch = texts.slice(i, i + BATCH_SIZE);
            const tensor = await embedder(batch, { pooling: 'mean', normalize: true });
            const vectors = tensorToVectors(tensor, batch.length);
            allVectors.push(...vectors);
        }
        
        return allVectors;
    } catch (error) {
        console.error('[EmbeddingService] Embedding generation failed', error);
        return texts.map(() => []);
    }
}

export async function embedText(text: string): Promise<number[]> {
    const [embedding] = await embedTexts([text]);
    return embedding || [];
}

export function resetEmbeddingCache() {
    embeddingPipelinePromise = null;
}
