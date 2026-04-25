import { spawn, ChildProcessByStdio } from 'child_process';
import { loggerService, LogCategory } from './loggerService.js';
import { settingsService } from './settingsService.js';
import { eventBusService } from './eventBusService.js';
import { KernelEventType } from '../types.js';
import { contextService } from './contextService.js';
import { activeSessionId } from '../index.js';
import { callFastInference } from './inferenceService.js';
import { ipcMain, app, systemPreferences } from 'electron';
import path from 'path';
import fs from 'fs';
import { Readable, Writable } from 'stream';
import { EventEmitter } from 'events';
import { LlamaPriority } from './llamaService.js';

class PythonVoiceManager extends EventEmitter {
    private process: ChildProcessByStdio<Writable, Readable, Readable> | null = null;
    private isVoiceModeActive = false;
    private systemName = "axiom";
    private voiceId = "af_sarah";
    private isReady = false;
    private lastSender: any = null;
    private stdoutBuffer = "";
    private isMicAccessGranted = false;
    private isSpeaking = false;
    private authenticatedSpeaker: string | null = null;

    constructor() {
        super();
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
                        this.handleSidecarMessage(msg);
                    } catch (e) {
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

        const profileCount = settings.voiceProfiles ? Object.keys(settings.voiceProfiles).length : 0;
        loggerService.catInfo(LogCategory.SYSTEM, `Initializing voice system with ${profileCount} profile(s)...`);

        // Pass all user profiles
        if (settings.voiceProfiles && Object.keys(settings.voiceProfiles).length > 0) {
            this.sendToSidecar('set_profiles', { profiles: settings.voiceProfiles });
        }
    }

    private sendToSidecar(action: string, payload: any) {
        if (this.process && this.process.stdin) {
            this.process.stdin.write(JSON.stringify({ action, payload }) + '\n');
        } else {
            loggerService.catError(LogCategory.SYSTEM, `Cannot send command ${action}: Sidecar process not running.`);
        }
    }

    private handleSidecarMessage(msg: any) {
        const { type, payload } = msg;
        this.emit('message', msg);

        if (type === 'alive') {
            // Heartbeat/Alive
        } else if (type === 'ready') {
            this.isReady = true;
            loggerService.catInfo(LogCategory.SYSTEM, `Python Sidecar Engine Ready (Device: ${payload.device})`);
            if (this.isVoiceModeActive && this.isMicAccessGranted) {
                this.sendToSidecar('mic_on', {});
            }
        } else if (type === 'profiles_ready') {
            loggerService.catInfo(LogCategory.SYSTEM, `Sidecar initialized ${payload.count} voice profile(s).`);
        } else if (type === 'stt_result') {
            this.authenticatedSpeaker = payload.speaker;
            if (this.lastSender) {
                this.lastSender.send('voice:match-score', { score: payload.score || 0, speaker: payload.speaker });
            }
            this.processFinalTranscription(payload.text);
        } else if (type === 'speaker_interrupt') {
            if (this.lastSender) {
                this.lastSender.send('voice:match-score', { score: payload.score || 0, speaker: payload.speaker });
            }
            if (this.isSpeaking) {
                loggerService.catInfo(LogCategory.SYSTEM, `Verified user '${payload.speaker}' interrupted AI speech.`);
                this.interruptPlayback();
            }
        } else if (type === 'tts_chunk') {
            if (this.lastSender) {
                this.isSpeaking = true;
                this.lastSender.send('voice:play-chunk', {
                    audio: payload.audio,
                    index: payload.index,
                    isLast: payload.isLast
                });
            }
        } else if (type === 'tts_complete') {
            loggerService.catInfo(LogCategory.SYSTEM, "Sidecar finished generating all TTS chunks.");
        } else if (type === 'enroll_progress') {
            if (this.lastSender) {
                this.lastSender.send('voice:enroll-progress', {
                    count: payload.count,
                    verified: payload.verified,
                    text: payload.text
                });
            }
        } else if (type === 'enroll_finalized') {
            if (this.lastSender) {
                this.lastSender.send('voice:enroll-finalized', payload);
            }
        } else if (type === 'profile_updated') {
            const { name, profile } = payload;
            loggerService.catInfo(LogCategory.SYSTEM, `Persisting refined voice profile for '${name}'...`);
            settingsService.getInferenceSettings().then(settings => {
                const profiles = settings.voiceProfiles || {};
                profiles[name] = profile;
                settingsService.update({ voiceProfiles: profiles });
            });
        } else if (type === 'error') {
            loggerService.catError(LogCategory.SYSTEM, "Sidecar reported error", { error: payload.message });
        }
    }

    private interruptPlayback() {
        this.isSpeaking = false;
        this.sendToSidecar('interrupt_tts', {});
        if (this.lastSender) {
            this.lastSender.send('voice:stop-playback');
        }
    }

    private async processFinalTranscription(text: string) {
        let cleanText = text.trim();
        const lowerText = cleanText.toLowerCase();
        const nameLower = this.systemName.toLowerCase();

        if (lowerText.includes(nameLower)) {
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
                text: cleanText,
                metadata: {
                    voice_authenticated_username: this.authenticatedSpeaker || 'Unknown'
                }
            } as const);

            if (this.lastSender) {
                this.lastSender.send('voice:play-ack-beep');
                this.lastSender.send('voice:stt-result', cleanText);
                this.lastSender.send('voice:trigger-submit', {
                    text: cleanText,
                    speaker: this.authenticatedSpeaker || 'Unknown'
                });
            }
        }
    }

    async toggleVoiceMode(active: boolean) {
        this.isVoiceModeActive = active;
        if (active) {
            await this.initialize();
            if (this.isReady && this.isMicAccessGranted) {
                this.sendToSidecar('mic_on', {});
            }
        } else {
            this.sendToSidecar('mic_off', {});
        }
        return this.isVoiceModeActive;
    }

    private setupIpc() {
        ipcMain.handle('voice:toggle-mode', async (event, active: boolean) => {
            this.lastSender = event.sender;
            return await this.toggleVoiceMode(active);
        });

        ipcMain.on('voice:playback-finished', () => {
            // We no longer suppress mic automatically, but keeping the event for state tracking if needed
            this.isSpeaking = false;
        });

        ipcMain.on('voice:enroll-start', async (event, { phrase }) => {
            this.lastSender = event.sender;
            if (!this.process) {
                await this.initialize();
            }
            this.sendToSidecar('enroll_start', { phrase });
            this.sendToSidecar('mic_on', {});
        });

        ipcMain.on('voice:enroll-next', (_, { phrase }) => {
            this.sendToSidecar('enroll_next', { phrase });
        });

        ipcMain.on('voice:enroll-stop', (_, { name }) => {
            this.sendToSidecar('enroll_stop', { name });
            this.sendToSidecar('mic_off', {});
            loggerService.catInfo(LogCategory.SYSTEM, `Stop enrollment command for '${name}' sent to sidecar and mic disabled.`);
        });
    }

    private async synthesizeSpeechText(rawText: string): Promise<string> {
        try {
            let processedText = rawText
                .replace(/<thought>[\s\S]*?<\/thought>/g, '')
                .replace(/<attachments>[\s\S]*?<\/attachments>/g, '')
                .trim();

            if (!processedText) return "";

            const prompt = `Convert the following text into a clean, natural sounding speech report. 
STRIP ALL titles, ALL markdown formatting, and technical symbols. Convert ALL headers to natural sounding transitions.
KEEP AND PRONOUNCE ALL PRODUCT NAMES, project names, and proper nouns (e.g., "SignalZero", "Tavily", "Electron").
EXPAND ALL ACRONYMS AND ABBREVIATIONS into their full spoken forms (e.g., "AI" to "Artificial Intelligence", "TTS" to "Text to Speech").
Do not say "Header", "Section", or read out structural markers. Do NOT repeat the same word twice in a row.
Just provide the core narrative content in a way that is easy to listen to.
Keep it professional and concise. Use punctuation to create natural pauses.

TEXT TO CONVERT:
${processedText}`;

            loggerService.catInfo(LogCategory.SYSTEM, "Synthesizing clean speech text via fast model...");
            const cleanSpeech = await callFastInference([
                { role: 'system', content: 'You are a speech synthesis pre-processor that strips headers and formatting.' },
                { role: 'user', content: prompt }
            ], 2560, undefined, LlamaPriority.URGENT);

            return cleanSpeech || processedText;
        } catch (e) {
            loggerService.catError(LogCategory.SYSTEM, "Failed to synthesize speech text", { error: e });
            return rawText;
        }
    }

    async speak(text: string, sender: any) {
        if (!this.process || !this.isReady) {
            return;
        }
        this.lastSender = sender;
        const speechText = await this.synthesizeSpeechText(text);
        this.isSpeaking = true;
        this.sendToSidecar('speak', { text: speechText, voice: this.voiceId });
    }
}

export const voiceService = new PythonVoiceManager();
