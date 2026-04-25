import { cameraStreamService } from './cameraStreamService.js';
import { screenStreamService } from './screenStreamService.js';
import { audioStreamService } from './audioStreamService.js';
import { perceptionTriggerService } from './perceptionTriggerService.js';
import { sceneManager } from './sceneManager.js';
import { voiceService } from './voiceProcess.js';
import { visionProcess } from './visionProcess.js';
import { loggerService, LogCategory } from '../loggerService.js';
import { settingsService } from '../settingsService.js';
import sharp from 'sharp';

const CAMERA_MAX_DIM = 224;
const SCREEN_MAX_DIM = 1280;

class RealtimeService {
    constructor() {
    }

    async initialize() {
        loggerService.catInfo(LogCategory.SYSTEM, "Initializing Realtime Service...");
        try {
            voiceService.on('interrupt', () => {
                loggerService.catInfo(LogCategory.SYSTEM, "Interrupted: Clearing AI speech queue.");
                this.speechQueue = [];
            });

            // Explicitly initialize links
            audioStreamService.initialize();
            
            cameraStreamService;
            screenStreamService;
            perceptionTriggerService;

            await visionProcess.initialize();
            await voiceService.ensureSidecarRunning();
            loggerService.catInfo(LogCategory.SYSTEM, "Realtime Service: Optical & Acoustic links initialized.");
        } catch (err: any) {
            loggerService.catError(LogCategory.SYSTEM, `Realtime Service: Initialization failed: ${err.message}`);
        }
    }

    async startStream(type: 'camera' | 'screen' | 'audio') {
        if (type === 'camera') {
            cameraStreamService.start();
            sceneManager.updateStatus('camera', { isActive: true });
        } else if (type === 'screen') {
            screenStreamService.start();
            sceneManager.updateStatus('screen', { isActive: true });
        } else if (type === 'audio') {
            await voiceService.toggleVoiceMode(true);
            sceneManager.updateStatus('audio', { isActive: true });
        }
    }

    async stopStream(type: 'camera' | 'screen' | 'audio') {
        if (type === 'camera') {
            cameraStreamService.stop();
            sceneManager.updateStatus('camera', { isActive: false });
        } else if (type === 'screen') {
            screenStreamService.stop();
            sceneManager.updateStatus('screen', { isActive: false });
        } else if (type === 'audio') {
            await voiceService.toggleVoiceMode(false);
            sceneManager.updateStatus('audio', { isActive: false });
        }
    }

    async toggleStream(type: 'camera' | 'screen' | 'audio') {
        const state = sceneManager.getState();
        const isActive = state[type].status.isActive;
        if (isActive) {
            await this.stopStream(type);
        } else {
            await this.startStream(type);
        }
        return !isActive;
    }

    getState() {
        return sceneManager.getState();
    }

    onUpdate(callback: (update: { type: string, state: any }) => void) {
        sceneManager.on('update', callback);
    }

    onStatusChange(callback: (update: { type: string, status: any }) => void) {
        sceneManager.on('status-change', callback);
    }

    private async downscaleFrame(base64Frame: string, maxDim: number): Promise<string> {
        const data = base64Frame.includes(',') ? base64Frame.split(',')[1] : base64Frame;
        try {
            const buffer = Buffer.from(data, 'base64');
            const resized = await sharp(buffer).resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
            return `data:image/jpeg;base64,${resized.toString('base64')}`;
        } catch {
            return base64Frame;
        }
    }

    async getSnapshot() {
        const state = sceneManager.getState();
        const snapshot: any = {};

        if (state.audio.status.isActive) {
            snapshot.audio = {
                lastSpeaker: state.audio.lastSpeaker,
                confidence: state.audio.recognitionConfidence,
                isSpeaking: state.audio.isSpeaking,
                transcription: state.audio.runningTranscript
            };
        }

        if (state.camera.status.isActive) {
            const hasFrame = !!state.camera.lastFrame;
            const frameSize = state.camera.lastFrame ? Math.round(state.camera.lastFrame.length / 1024) : 0;
            loggerService.catDebug(LogCategory.SYSTEM, `Capture: Camera frame availability: ${hasFrame}, size: ${frameSize}KB`);
            
            let cameraFrame = state.camera.lastFrame;
            if (cameraFrame) {
                cameraFrame = await this.downscaleFrame(cameraFrame, CAMERA_MAX_DIM);
            }

            snapshot.camera = {
                lastFrame: cameraFrame,
                people: state.camera.people.map(p => ({
                    id: p.id,
                    expression: p.expression,
                    confidence: p.attributes.detection_confidence,
                    emotions: p.attributes.emotion_scores
                }))
            };
            }

            if (state.screen.status.isActive) {
            const hasFrame = !!state.screen.lastFrame;
            const frameSize = state.screen.lastFrame ? Math.round(state.screen.lastFrame.length / 1024) : 0;
            loggerService.catDebug(LogCategory.SYSTEM, `Capture: Screen frame availability: ${hasFrame}, size: ${frameSize}KB`);

            let screenFrame = state.screen.lastFrame;
            if (screenFrame) {
                screenFrame = await this.downscaleFrame(screenFrame, SCREEN_MAX_DIM);
            }

            snapshot.screen = {
                lastFrame: screenFrame,
                activeApplication: state.screen.activeApplication
            };
            }
        return Object.keys(snapshot).length > 0 ? snapshot : null;
    }

    private speechQueue: { text: string, sender: any }[] = [];
    private isProcessingQueue = false;

    async cancelSpeech() {
        this.speechQueue = [];
        // This will stop the current sidecar playback AND clear the renderer queue
        voiceService.interrupt();
        loggerService.catInfo(LogCategory.SYSTEM, "AI speech cancelled by user/system command.");
    }

    async speak(text: string, sender: any) {
        const settings = await settingsService.get();
        if (!settings.voiceEnabled) {
            loggerService.catDebug(LogCategory.SYSTEM, "AI Speech suppressed: voiceEnabled is false.");
            return;
        }

        loggerService.catDebug(LogCategory.SYSTEM, `Queueing TTS message: "${text.substring(0, 50)}..."`);
        this.speechQueue.push({ text, sender });
        
        if (!this.isProcessingQueue) {
            this.processSpeechQueue().catch(err => {
                loggerService.catError(LogCategory.SYSTEM, `Speech queue processing error: ${err.message}`);
                this.isProcessingQueue = false;
            });
        }
    }

    async setVoiceEnabled(enabled: boolean) {
        if (!enabled) {
            await this.cancelSpeech();
        }
        await settingsService.update({ voiceEnabled: enabled });
        return enabled;
    }

    private async processSpeechQueue() {
        if (this.isProcessingQueue) return;
        this.isProcessingQueue = true;

        try {
            while (this.speechQueue.length > 0) {
                // If voice system is currently speaking from a previous direct call or slow process
                while (voiceService.getIsSpeaking()) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }

                const item = this.speechQueue.shift();
                if (!item) break;

                loggerService.catInfo(LogCategory.SYSTEM, `Processing queued speech: "${item.text.substring(0, 100)}..."`);
                
                // This triggers the synthesis and playback start. 
                // It returns after synthesis is done and playback has been commanded to start.
                await voiceService.speak(item.text, item.sender);

                // If it successfully started speaking, wait for it to finish
                if (voiceService.getIsSpeaking()) {
                    while (voiceService.getIsSpeaking()) {
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                }

                // NICE PAUSE between messages
                if (this.speechQueue.length > 0) {
                    loggerService.catDebug(LogCategory.SYSTEM, "Speech queue: waiting 800ms before next message...");
                    await new Promise(resolve => setTimeout(resolve, 800));
                }
            }
        } finally {
            this.isProcessingQueue = false;
        }
    }
}

export const realtimeService = new RealtimeService();
