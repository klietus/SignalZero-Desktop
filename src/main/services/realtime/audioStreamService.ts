import { sceneManager } from './sceneManager.js';
import { eventBusService, KernelEventType } from '../eventBusService.js';
import { voiceService } from './voiceProcess.js';

class AudioStreamService {
    constructor() {
        this.initialize();
    }

    private initialize() {
        // Listen to events from the event bus that the voice service might emit
        eventBusService.onKernelEvent(KernelEventType.CONTEXT_UPDATED, (data) => {
            if (data.type === 'voice_wake_word_detected') {
                sceneManager.updateAudio({
                    lastSpeaker: data.metadata?.voice_authenticated_username || 'Unknown',
                    runningTranscript: data.text,
                    isSpeaking: true
                });
            }
        });

        // Listen to direct sidecar messages via voiceService
        voiceService.on('message', (msg) => {
            const { type, payload } = msg;
            
            if (type === 'stt_result') {
                const state = sceneManager.getState().audio;
                const newEntry = payload.text?.trim();
                
                if (!newEntry) return; // Ignore empty lines

                // Append and limit size
                const updatedTranscript = (state.runningTranscript + "\n" + newEntry).trim().split("\n").slice(-20).join("\n");

                sceneManager.updateAudio({
                    lastSpeaker: payload.speaker,
                    recognitionConfidence: payload.score || 0,
                    runningTranscript: updatedTranscript,
                    vocalEmotion: payload.vocal_emotion || 'neutral',
                    isSpeaking: false
                });
            } else if (type === 'audio_metrics') {
                sceneManager.updateAudio({
                    rmsLevel: payload.rms,
                    isSpeaking: payload.is_speaking
                });
            }
        });
    }
}

export const audioStreamService = new AudioStreamService();
