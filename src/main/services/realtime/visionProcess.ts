import { spawn, ChildProcessByStdio } from 'child_process';
import { loggerService, LogCategory } from '../loggerService.js';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { Readable, Writable } from 'stream';
import { EventEmitter } from 'events';

class VisionProcess extends EventEmitter {
    private process: ChildProcessByStdio<Writable, Readable, Readable> | null = null;
    private stdoutBuffer = "";
    private isInitializing = false;

    async initialize() {
        if (this.process || this.isInitializing) return;
        this.isInitializing = true;
        
        try {
            const sidecarDir = app.isPackaged
                ? path.join(process.resourcesPath, 'sidecars', 'vision')
                : path.join(app.getAppPath(), 'sidecars', 'vision');

            const pythonExe = app.isPackaged
                ? path.join(sidecarDir, 'python-portable', 'bin', 'python3')
                : (fs.existsSync(path.join(sidecarDir, 'python-portable', 'bin', 'python3'))
                    ? path.join(sidecarDir, 'python-portable', 'bin', 'python3')
                    : 'python3');

            const mainScript = path.join(sidecarDir, 'main.py');

            loggerService.catInfo(LogCategory.SYSTEM, `Launching Vision Sidecar`, { pythonExe, script: mainScript, cwd: sidecarDir });

            if (!fs.existsSync(mainScript)) {
                loggerService.catError(LogCategory.SYSTEM, `Vision Sidecar script NOT FOUND at ${mainScript}`);
                this.isInitializing = false;
                return;
            }

        this.process = spawn(pythonExe, ['-u', mainScript], {
            cwd: sidecarDir,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                PYTHONUNBUFFERED: '1',
                DYLD_FRAMEWORK_PATH: '/System/Library/Frameworks',
                DYLD_LIBRARY_PATH: path.join(sidecarDir, 'deps', 'lib'),
                ORT_DISABLE_MEM_ARENA: '1',
                ONNX_RUNTIME_SESSION_OPTIONS_ENABLE_CPU_MEM_ARENA: '0'
            }
        });

        this.process.stdout.on('data', (data) => {
            this.stdoutBuffer += data.toString();
            let boundary = this.stdoutBuffer.indexOf('\n');
            while (boundary !== -1) {
                const line = this.stdoutBuffer.substring(0, boundary).trim();
                this.stdoutBuffer = this.stdoutBuffer.substring(boundary + 1);
                if (line) {
                    try {
                        const msg = JSON.parse(line);
                        if (msg.type === 'log') {
                            loggerService.catInfo(LogCategory.SYSTEM, `Vision Sidecar: ${msg.payload}`);
                        } else {
                            this.emit('message', msg);
                        }
                    } catch (e) {
                        // Suppress noisy logs for malformed or extremely large JSON lines (like image payloads)
                    }
                }
                boundary = this.stdoutBuffer.indexOf('\n');
            }
        });

        this.process.stderr.on('data', (data) => {
            const msg = data.toString().trim();
            if (!msg) return;

            // MediaPipe diagnostic log handling (I0000 = Info, W0000 = Warn)
            if (msg.startsWith('I') && /I\d{8}/.test(msg)) {
                loggerService.catInfo(LogCategory.SYSTEM, `Vision Sidecar: ${msg}`);
            } else if (msg.startsWith('W') && /W\d{8}/.test(msg)) {
                loggerService.catWarn(LogCategory.SYSTEM, `Vision Sidecar Warning: ${msg}`);
            } else {
                loggerService.catError(LogCategory.SYSTEM, `Vision Sidecar Error: ${msg}`);
            }
            
            if (msg.includes('ModuleNotFoundError')) {
                loggerService.catError(LogCategory.SYSTEM, "Vision Sidecar missing dependencies. Please run 'sidecars/vision/setup.sh'");
            }
        });

        this.process.on('exit', (code, signal) => {
            this.process = null;
            this.isInitializing = false;
            loggerService.catError(LogCategory.SYSTEM, `Vision Sidecar exited with code ${code} and signal ${signal}`);
        });

        this.isInitializing = false;
    } catch (err: any) {
        this.isInitializing = false;
        loggerService.catError(LogCategory.SYSTEM, `Failed to launch Vision Sidecar: ${err.message}`);
    }
}

    send(action: string, payload: any) {
        if (this.process && this.process.stdin) {
            this.process.stdin.write(JSON.stringify({ action, payload }) + '\n');
        }
    }

    /** @internal */
    resetForTest() {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
        this.stdoutBuffer = "";
        this.removeAllListeners();
    }
}

export const visionProcess = new VisionProcess();
