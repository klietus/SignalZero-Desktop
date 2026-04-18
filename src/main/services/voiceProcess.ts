import { spawn, ChildProcessByStdio } from 'child_process';
import { loggerService, LogCategory } from './loggerService.js';
import { settingsService } from './settingsService.js';
import { eventBusService, KernelEventType } from './eventBusService.js';
import { contextService } from './contextService.js';
import { activeSessionId } from '../index.js';
import { callFastInference } from './inferenceService.js';
import { ipcMain, app, systemPreferences } from 'electron';
import path from 'path';
import fs from 'fs';
import { Readable, Writable } from 'stream';

class PythonVoiceManager {
    private process: ChildProcessByStdio<Writable, Readable, Readable> | null = null;
    private isVoiceModeActive = false;
    private systemName = "axiom"; 
    private voiceId = "af_sarah";
    private isReady = false;
    private lastSender: any = null;
    private stdoutBuffer = "";
    private isMicAccessGranted = false;
    private isSpeaking = false;

    constructor() {
        this.setupIpc();
    }

    async initialize() {
        if (this.process) return;

        // On macOS, explicitly ask for microphone access
        if (process.platform === 'darwin') {
            try {
                const access = await systemPreferences.askForMediaAccess('microphone');
                this.isMicAccessGranted = access;
                if (!access) {
                    loggerService.catError(LogCategory.SYSTEM, "Microphone access denied by user.");
                    return;
                }
            } catch (e) {
                loggerService.catError(LogCategory.SYSTEM, "Failed to request mic access", { error: e });
            }
        } else {
            this.isMicAccessGranted = true;
        }

        const settings = await settingsService.getInferenceSettings();
        this.systemName = settings.systemName || "axiom";
        this.voiceId = settings.voiceId || "af_sarah";

        const sidecarDir = app.isPackaged 
            ? path.join(process.resourcesPath, 'sidecars', 'voice') 
            : path.join(app.getAppPath(), 'sidecars', 'voice');

        const pythonExe = app.isPackaged
            ? path.join(sidecarDir, 'python-portable', 'bin', 'python3')
            : (fs.existsSync(path.join(sidecarDir, 'python-portable', 'bin', 'python3')) 
                ? path.join(sidecarDir, 'python-portable', 'bin', 'python3') 
                : 'python3'); 

        const mainScript = path.join(sidecarDir, 'main.py');

        loggerService.catInfo(LogCategory.SYSTEM, `Launching Python Voice Sidecar: ${pythonExe}`);

        this.process = spawn(pythonExe, ['-u', mainScript], {
            cwd: sidecarDir,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { 
                ...process.env, 
                PYTHONUNBUFFERED: '1',
                DYLD_FRAMEWORK_PATH: '/System/Library/Frameworks',
                DYLD_LIBRARY_PATH: path.join(sidecarDir, 'deps', 'lib')
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
                        this.handleSidecarMessage(msg);
                    } catch (e) {
                        // Not JSON, treat as a log message if it doesn't look like fragmented JSON
                        if (!line.startsWith('{') && !line.startsWith('"')) {
                            loggerService.catInfo(LogCategory.SYSTEM, `Sidecar Log: ${line}`);
                        }
                    }
                }
                boundary = this.stdoutBuffer.indexOf('\n');
            }
        });

        this.process.stderr.on('data', (data) => {
            const msg = data.toString().trim();
            if (!msg) return;
            
            // Distinguish between info and error logs from python
            if (msg.includes(' - INFO - ') || msg.includes(' - WARNING - ')) {
                loggerService.catInfo(LogCategory.SYSTEM, `Sidecar: ${msg}`);
            } else {
                loggerService.catError(LogCategory.SYSTEM, `Sidecar Error: ${msg}`);
            }
        });

        this.process.on('exit', (code, signal) => {
            this.isReady = false;
            this.process = null;
            this.stdoutBuffer = "";
            loggerService.catError(LogCategory.SYSTEM, `Python Sidecar exited with code ${code} and signal ${signal}`);
            
            if (this.isVoiceModeActive) {
                setTimeout(() => this.initialize(), 5000);
            }
        });

        this.sendToSidecar('init', {});
    }

    private sendToSidecar(action: string, payload: any) {
        if (this.process && this.process.stdin) {
            this.process.stdin.write(JSON.stringify({ action, payload }) + '\n');
        }
    }

    private handleSidecarMessage(msg: any) {
        const { type, payload } = msg;

        if (type === 'ready') {
            this.isReady = true;
            loggerService.catInfo(LogCategory.SYSTEM, `Python Sidecar Ready (Device: ${payload.device})`);
            if (this.isVoiceModeActive && this.isMicAccessGranted) {
                this.sendToSidecar('mic_on', {});
            }
        } else if (type === 'stt_result') {
            this.processFinalTranscription(payload.text);
        } else if (type === 'tts_chunk') {
            if (this.lastSender) {
                // Ensure mic is suppressed on the very first chunk
                if (!this.isSpeaking) {
                    this.isSpeaking = true;
                    this.sendToSidecar('suppress_mic', {});
                }
                this.lastSender.send('voice:play-chunk', {
                    audio: payload.audio,
                    index: payload.index,
                    isLast: payload.is_last
                });
            }
        } else if (type === 'tts_complete') {
            // Note: We don't resume mic here yet, we wait for renderer to finish playing ALL chunks
            loggerService.catInfo(LogCategory.SYSTEM, "Sidecar finished generating all TTS chunks.");
        } else if (type === 'error') {
            loggerService.catError(LogCategory.SYSTEM, "Sidecar reported error", { error: payload.message });
        }
    }

    private async processFinalTranscription(text: string) {
        let cleanText = text.trim();
        const lowerText = cleanText.toLowerCase();
        const nameLower = this.systemName.toLowerCase();

        if (lowerText.includes(nameLower)) {
            // Check if there is an active session and it is not busy
            if (!activeSessionId) {
                loggerService.catInfo(LogCategory.SYSTEM, `Wake word detected but no active session found. Ignoring.`);
                return;
            }

            const isBusy = await contextService.hasActiveMessage(activeSessionId);
            if (isBusy) {
                loggerService.catInfo(LogCategory.SYSTEM, `Wake word detected but session ${activeSessionId} is busy. Ignoring.`);
                return;
            }

            loggerService.catInfo(LogCategory.SYSTEM, `Wake word detected! Routing: ${cleanText}`);
            
            eventBusService.emitKernelEvent(KernelEventType.CONTEXT_UPDATED, { 
                type: 'voice_wake_word_detected',
                text: cleanText 
            });

            if (this.lastSender) {
                this.lastSender.send('voice:stt-result', cleanText);
                this.lastSender.send('voice:trigger-submit', cleanText);
            }
        }
    }

    private setupIpc() {
        ipcMain.handle('voice:toggle-mode', async (event, active: boolean) => {
            this.isVoiceModeActive = active;
            this.lastSender = event.sender;
            if (active) {
                await this.initialize(); 
                if (this.isReady && this.isMicAccessGranted) {
                    this.sendToSidecar('mic_on', {});
                }
            } else {
                this.sendToSidecar('mic_off', {});
            }
            return this.isVoiceModeActive;
        });

        ipcMain.on('voice:playback-finished', () => {
            this.isSpeaking = false;
            this.sendToSidecar('resume_mic', {});
            loggerService.catInfo(LogCategory.SYSTEM, "Playback finished. Resuming mic.");
        });
    }

    private async synthesizeSpeechText(rawText: string): Promise<string> {
        try {
            // Pre-strip internal thought blocks and attachment tags before LLM synthesis
            let processedText = rawText
                .replace(/<thought>[\s\S]*?<\/thought>/g, '')
                .replace(/<attachments>[\s\S]*?<\/attachments>/g, '')
                .trim();

            if (!processedText) return "";

            const prompt = `Convert the following text into a clean, natural sounding speech report. 
STRIP ALL HEADERS, titles, markdown formatting, technical symbols, and foreign words. 
Do not say "Header", "Section", or read out structural markers. 
Just provide the core narrative content in a way that is easy to listen to.
Keep it professional and concise.

TEXT TO CONVERT:
${processedText}`;

            loggerService.catInfo(LogCategory.SYSTEM, "Synthesizing clean speech text via fast model...");
            const cleanSpeech = await callFastInference([
                { role: 'system', content: 'You are a speech synthesis pre-processor that strips headers and formatting.' },
                { role: 'user', content: prompt }
            ]);

            return cleanSpeech || processedText;
        } catch (e) {
            loggerService.catError(LogCategory.SYSTEM, "Failed to synthesize speech text", { error: e });
            return rawText; // Fallback to raw text if synthesis fails
        }
    }

    async speak(text: string, sender: any) {
        if (!this.process || !this.isReady) {
            return;
        }
        this.lastSender = sender;

        // Pre-process text through fast model for natural speech
        const speechText = await this.synthesizeSpeechText(text);
        
        this.sendToSidecar('speak', { text: speechText, voice: this.voiceId });
    }
}

export const voiceService = new PythonVoiceManager();
