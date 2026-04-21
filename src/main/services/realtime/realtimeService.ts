import { cameraStreamService } from './cameraStreamService.js';
import { screenStreamService } from './screenStreamService.js';
import { audioStreamService } from './audioStreamService.js';
import { perceptionTriggerService } from './perceptionTriggerService.js';
import { sceneManager } from './sceneManager.js';
import { voiceService } from './voiceProcess.js';
import { visionProcess } from './visionProcess.js';
import { loggerService, LogCategory } from '../loggerService.js';

class RealtimeService {
    async initialize() {
        loggerService.catInfo(LogCategory.SYSTEM, "Initializing Realtime Service...");
        try {
            // Loading these ensures the listeners in the service constructors are active
            audioStreamService;
            cameraStreamService;
            screenStreamService;
            perceptionTriggerService;

            await visionProcess.initialize();
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

    getSnapshot() {
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
            
            snapshot.camera = {
                lastFrame: state.camera.lastFrame,
                people: state.camera.people.map(p => ({
                    id: p.id,
                    expression: p.expression,
                    confidence: p.attributes.detection_confidence,
                    emotions: p.attributes.emotion_scores
                })),
                detectedObjects: state.camera.detectedObjects
            };
        }

        if (state.screen.status.isActive) {
            const hasFrame = !!state.screen.lastFrame;
            const frameSize = state.screen.lastFrame ? Math.round(state.screen.lastFrame.length / 1024) : 0;
            loggerService.catDebug(LogCategory.SYSTEM, `Capture: Screen frame availability: ${hasFrame}, size: ${frameSize}KB`);
            
            snapshot.screen = {
                lastFrame: state.screen.lastFrame,
                activeApplication: state.screen.activeApplication,
                ocrText: state.screen.ocrText
            };
        }

        return Object.keys(snapshot).length > 0 ? snapshot : null;
    }

    async speak(text: string, sender: any) {
        return voiceService.speak(text, sender);
    }
}

export const realtimeService = new RealtimeService();
