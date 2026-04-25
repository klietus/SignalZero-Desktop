import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const sidecarDir = path.join(process.cwd(), 'sidecars', 'vision');
const mainScript = path.join(sidecarDir, 'main.py');
const pythonPortable = path.join(sidecarDir, 'python-portable', 'bin', 'python3');
const pythonExe = fs.existsSync(pythonPortable) ? pythonPortable : 'python3';
const hasPython = (() => { try { require('child_process').execSync(`${pythonExe} --version`, { stdio: 'ignore' }); return true; } catch { return false; } })();

describe('Vision Sidecar (Python)', () => {
    it.skip('should be able to import core dependencies', async () => {
        const checkScript = `
import sys
try:
    import cv2
    import mediapipe
    import numpy
    import mss
    print("SUCCESS")
except ImportError as e:
    print(f"MISSING: {e.name}")
    sys.exit(1)
`;
        
        return new Promise((resolve, reject) => {
            const proc = spawn(pythonExe, ['-c', checkScript], { env: process.env });
            let stdout = '';
            let stderr = '';
            
            proc.stdout.on('data', d => stdout += d.toString());
            proc.stderr.on('data', d => stderr += d.toString());
            
            proc.on('close', (code) => {
                if (code === 0 && stdout.trim() === 'SUCCESS') {
                    resolve(true);
                } else {
                    reject(new Error(`Python dependency check failed.\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`));
                }
            });
        });
    }, 30000); // Give it time to load heavy models/libs

    it.skip('should respond to quit command', async () => {
        return new Promise((resolve, reject) => {
            const proc = spawn(pythonExe, ['-u', mainScript], {
                cwd: sidecarDir,
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            let output = '';
            proc.stdout.on('data', (data) => {
                const line = data.toString();
                output += line;
                if (line.includes('Vision sidecar initialized')) {
                    proc.stdin.write(JSON.stringify({ action: 'quit' }) + '\n');
                }
            });

            const timeout = setTimeout(() => {
                proc.kill();
                reject(new Error('Quit command timed out'));
            }, 5000);

            proc.on('close', () => {
                clearTimeout(timeout);
                resolve(true);
            });
        });
    });
});
