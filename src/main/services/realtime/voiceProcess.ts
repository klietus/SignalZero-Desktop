import { spawn, ChildProcessByStdio } from 'child_process';
import { loggerService, LogCategory } from '../loggerService.js';
import { settingsService } from '../settingsService.js';
import { eventBusService, KernelEventType } from '../eventBusService.js';
import { contextService } from '../contextService.js';
import { uiStateService } from '../uiStateService.js';
import { callFastInference } from '../inferenceService.js';
import { LlamaPriority } from '../llamaService.js';
import { ipcMain, app, systemPreferences } from 'electron';
import path from 'path';
import fs from 'fs';
import { Readable, Writable } from 'stream';
import { EventEmitter } from 'events';
import { transcriptManager } from './transcriptManager.js';

class PythonVoiceManager extends EventEmitter {
    private process: ChildProcessByStdio<Writable, Readable, Readable> | null = null;
    private isVoiceModeActive = false;
    private systemName = "axiom";
    private voiceId = "af_sarah";
    private isReady = false;
    private stdoutBuffer = "";
    private isMicAccessGranted = false;
    private isSpeaking = false;
    private authenticatedSpeaker: string | null = null;
    private lastInterruptTime = 0;

    constructor() {
        super();
        this.setupIpc();

        // Listen for settings changes to update system name/voice ID dynamically
        eventBusService.onKernelEvent(KernelEventType.SETTINGS_UPDATED, async () => {
            const settings = await settingsService.getInferenceSettings();
            this.systemName = settings.systemName || "axiom";
            this.voiceId = settings.voiceId || "af_sarah";
            loggerService.catInfo(LogCategory.SYSTEM, `VoiceProcess: Settings updated. System name: ${this.systemName}, Voice: ${this.voiceId}`);
        });
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
        loggerService.catInfo(LogCategory.SYSTEM, `VoiceProcess: Initialized. System name: ${this.systemName}, Voice: ${this.voiceId}`);

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
                        loggerService.catDebug(LogCategory.SYSTEM, `VoiceProcess: IPC parse error: ${e}. Line: ${line}`);
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

    private async handleSidecarMessage(msg: any) {
        const { type, payload } = msg;

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
            loggerService.catInfo(LogCategory.SYSTEM, `VoiceProcess: Received STT: "${payload.text}" (Speaker: ${payload.speaker}, Score: ${payload.score}, Emotion: ${payload.vocal_emotion})`);
            
            // AI Echo Cancellation (Main Process side)
            if (this.isSpeaking) {
                loggerService.catDebug(LogCategory.SYSTEM, "VoiceProcess: Suppressing STT result because AI is currently speaking (echo).");
                return;
            }

            this.authenticatedSpeaker = payload.speaker;
            
            // 1. Always emit for the perception transcript
            this.emit('message', msg);
            
            uiStateService.broadcast('voice:match-score', { score: payload.score || 0, speaker: payload.speaker });
            await this.processFinalTranscription(payload.text, payload.vocal_emotion);
        } else if (type === 'speaker_interrupt') {
            uiStateService.broadcast('voice:match-score', { score: payload.score || 0, speaker: payload.speaker });
            if (this.isSpeaking) {
                loggerService.catInfo(LogCategory.SYSTEM, `Verified user '${payload.speaker}' interrupted AI speech.`);
                this.interrupt();
            }
        } else if (type === 'tts_chunk') {
            this.isSpeaking = true;
            uiStateService.broadcast('voice:play-chunk', {
                audio: payload.audio,
                index: payload.index,
                isLast: payload.isLast
            });
        } else if (type === 'tts_complete') {
            loggerService.catInfo(LogCategory.SYSTEM, "Sidecar finished generating all TTS chunks.");
        } else if (type === 'enroll_progress') {
            uiStateService.broadcast('voice:enroll-progress', {
                count: payload.count,
                verified: payload.verified,
                text: payload.text
            });
        } else if (type === 'enroll_finalized') {
            uiStateService.broadcast('voice:enroll-finalized', payload);
        } else if (type === 'audio_metrics') {
            this.emit('message', msg);
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
        this.lastInterruptTime = Date.now();
        this.sendToSidecar('interrupt_tts', {});
        uiStateService.broadcast('voice:stop-playback');
    }

    public interrupt() {
        this.emit('interrupt');
        this.interruptPlayback();
    }

    private async processFinalTranscription(text: string, emotion?: string) {
        let cleanText = text.trim();
        const lowerText = cleanText.toLowerCase();
        const nameLower = this.systemName.toLowerCase();

        const activeSessionId = uiStateService.activeSessionId;
        loggerService.catDebug(LogCategory.SYSTEM, `VoiceProcess: Checking for wake word '${nameLower}' in "${lowerText}" (ActiveSession: ${activeSessionId})`);

        if (lowerText.includes(nameLower)) {
            if (!activeSessionId) {
                loggerService.catInfo(LogCategory.SYSTEM, `Wake word detected but activeSessionId is null. Routing failed.`);
                return;
            }

            const isBusy = await contextService.hasActiveMessage(activeSessionId);
            if (isBusy) {
                loggerService.catInfo(LogCategory.SYSTEM, `Wake word detected but session ${activeSessionId} is busy. Ignoring.`);
                return;
            }

            const speaker = this.authenticatedSpeaker || 'Unknown';
            const aggregatedText = transcriptManager.getSpeakerContext(speaker);
            const finalText = aggregatedText || cleanText;

            loggerService.catInfo(LogCategory.SYSTEM, `Wake word detected! Routing to ${activeSessionId}. Text: ${finalText}`);

            eventBusService.emitKernelEvent(KernelEventType.CONTEXT_UPDATED, {
                type: 'voice_wake_word_detected',
                text: finalText,
                metadata: {
                    voice_authenticated_username: speaker,
                    vocal_emotion: emotion || 'neutral'
                }
            });

            uiStateService.broadcast('voice:play-ack-beep');
            uiStateService.broadcast('voice:stt-result', cleanText);
            uiStateService.broadcast('voice:trigger-submit', {
                text: finalText,
                speaker: speaker
            });
        } else {
            loggerService.catDebug(LogCategory.SYSTEM, `VoiceProcess: Text did not match wake word '${nameLower}'.`);
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
        ipcMain.on('voice:playback-finished', () => {
            // We no longer suppress mic automatically, but keeping the event for state tracking if needed
            this.isSpeaking = false;
            this.sendToSidecar('mic_suppress_off', {});
        });

        ipcMain.on('voice:enroll-start', async (_, { phrase }) => {
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

    private stripMarkdown(text: string): string {
        return text
            // Remove code blocks
            .replace(/```[\s\S]*?```/g, '')
            // Remove inline code
            .replace(/`([^`]+)`/g, '$1')
            // Remove images
            .replace(/!\[([^\]]*)\]\([^\)]+\)/g, '')
            // Remove links but keep text
            .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
            // Remove headers
            .replace(/^#{1,6}\s+/gm, '')
            // Remove bold/italic
            .replace(/(\*\*|__)(.*?)\1/g, '$2')
            // Remove single star/underscore italic
            .replace(/(\*|_)(.*?)\1/g, '$2')
            // Remove blockquotes
            .replace(/^\s*>\s+/gm, '')
            // Remove horizontal rules
            .replace(/^[-\*_]{3,}\s*$/gm, '')
            // Remove list markers
            .replace(/^\s*[\-\*\+]\s+/gm, '')
            .replace(/^\s*\d+\.\s+/gm, '')
            // Remove custom tags
            .replace(/<[^>]*>/g, '')
            // Trim extra whitespace
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    private async synthesizeSpeechText(rawText: string): Promise<string> {
        try {
            // Pre-process to remove thoughts and attachments which should never be spoken
            let processedText = rawText
                .replace(/<(?:seed:)?thought>[\s\S]*?<\/(?:seed:)?thought>/g, '')
                .replace(/<attachments>[\s\S]*?<\/attachments>/g, '')
                .trim();

            if (!processedText) return "";

            // Strip markdown before sending to LLM for final natural language synthesis
            processedText = this.stripMarkdown(processedText);

            const prompt = `Convert the following text into a clean, natural sounding speech report. 
STRIP ALL remaining titles, markdown formatting, and technical symbols. Convert ALL headers to natural sounding transitions.
KEEP AND PRONOUNCE ALL PRODUCT NAMES, project names, and proper nouns (e.g., "SignalZero", "Tavily", "Electron").
EXPAND ALL ACRONYMS AND ABBREVIATIONS into their full spoken forms (e.g., "AI" to "Artificial Intelligence", "TTS" to "Text to Speech").
Do not say "Header", "Section", or read out structural markers. Do NOT repeat the same word twice in a row.
Just provide the core narrative content in a way that is easy to listen to.
Keep it professional and concise.

TEXT TO CONVERT:
${processedText}`;

            loggerService.catInfo(LogCategory.SYSTEM, "Synthesizing clean speech text via fast model...");
            const cleanSpeech = await callFastInference([
                { role: 'system', content: 'You are a speech synthesis pre-processor that strips headers and formatting.' },
                { role: 'user', content: prompt }
            ], 5120, undefined, LlamaPriority.URGENT);

            return cleanSpeech || processedText;
        } catch (e) {
            loggerService.catError(LogCategory.SYSTEM, "Failed to synthesize speech text", { error: e });
            return this.stripMarkdown(rawText);
        }
    }

    async speak(text: string, _sender: any) {
        if (!this.process || !this.isReady) {
            return;
        }
        
        const startTime = Date.now();

        // Suppress mic during synthesis/playback
        this.sendToSidecar('mic_suppress_on', {});
        
        try {
            const speechText = await this.synthesizeSpeechText(text);
            
            // ABORT: If an interrupt occurred while we were synthesizing
            if (this.lastInterruptTime > startTime) {
                loggerService.catInfo(LogCategory.SYSTEM, "Aborting speech synthesis: User interrupted during processing.");
                this.sendToSidecar('mic_suppress_off', {});
                this.isSpeaking = false;
                return;
            }

            if (!speechText) {
                this.sendToSidecar('mic_suppress_off', {});
                this.isSpeaking = false;
                return;
            }
            this.isSpeaking = true;
            this.sendToSidecar('speak', { text: speechText, voice: this.voiceId });
        } catch (e) {
            loggerService.catError(LogCategory.SYSTEM, "Failed to speak text", { error: e });
            this.sendToSidecar('mic_suppress_off', {});
            this.isSpeaking = false;
        }
    }

    getIsSpeaking() {
        return this.isSpeaking;
    }
}

export const voiceService = new PythonVoiceManager();
