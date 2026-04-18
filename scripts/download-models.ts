import { pipeline, env } from '@huggingface/transformers';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

// Configuration for Transformers.js
const modelsDir = path.join(process.cwd(), 'models');
if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
}

// CRITICAL: Set cacheDir to our local models folder
env.cacheDir = modelsDir; 
env.allowRemoteModels = true;

const MODELS = [
    { task: 'feature-extraction', model: 'Xenova/all-MiniLM-L6-v2', dtype: 'fp32' }
];

async function download() {
    console.log(`Starting simplified model downloads (CPU/FP32) to: ${modelsDir}`);

    for (const item of MODELS) {
        console.log(`\nDownloading ${item.model} (${item.task})...`);
        try {
            await pipeline(item.task as any, item.model, {
                dtype: item.dtype as any,
                device: 'cpu'
            });
            console.log(`Successfully downloaded ${item.model}`);
        } catch (err: any) {
            console.error(`Failed to download ${item.model}:`, err.message);
        }
    }

    // DOWNLOAD FOR PYTHON SIDECAR
    console.log(`\nDownloading Kokoro v1.0 for Python Sidecar...`);
    const pythonSidecarDir = path.join(process.cwd(), 'sidecars', 'voice');
    const pythonKokoroFile = path.join(pythonSidecarDir, 'kokoro-v1.0.onnx');
    const pythonVoicesFile = path.join(pythonSidecarDir, 'voices.bin');
    const pythonSarahVoice = path.join(pythonSidecarDir, 'af_sarah.bin');

    if (!fs.existsSync(pythonSidecarDir)) {
        fs.mkdirSync(pythonSidecarDir, { recursive: true });
    }

    if (!fs.existsSync(pythonKokoroFile)) {
        console.log("Downloading kokoro-v1.0.onnx for Python...");
        execSync(`curl -L -o "${pythonKokoroFile}" "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"`);
    }
    if (!fs.existsSync(pythonVoicesFile)) {
        console.log("Downloading voices.bin for Python...");
        execSync(`curl -L -o "${pythonVoicesFile}" "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"`);
    }
    if (!fs.existsSync(pythonSarahVoice)) {
        console.log("Downloading af_sarah.bin for Python...");
        execSync(`curl -L -o "${pythonSarahVoice}" "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/af_sarah.bin"`);
    }
    
    console.log('\nAll model downloads completed.');
}

download();
