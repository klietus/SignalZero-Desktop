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
                    transcription: data.text,
                    isSpeaking: true
                });
            }
        });

        // Listen to direct sidecar messages via voiceService
        voiceService.on('message', (msg) => {
            const { type, payload } = msg;
            
            if (type === 'stt_result') {
                sceneManager.updateAudio({
                    lastSpeaker: payload.speaker,
                    recognitionConfidence: payload.score || 0,
                    transcription: payload.text,
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
