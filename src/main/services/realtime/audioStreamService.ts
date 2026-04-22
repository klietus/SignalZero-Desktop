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
                const confidence = payload.score || 0;
                
                if (!newEntry) return;

                // --- HALLUCINATION FILTER ---
                // 1. Confidence Threshold (Whisper hallucinations are often very low confidence)
                if (confidence < 0.25) {
                    loggerService.catDebug(LogCategory.SYSTEM, `Audio: Suppressing low-confidence STT hallucination (${confidence}): "${newEntry}"`);
                    return;
                }

                // 2. Common Phrase Blacklist (Classic Whisper debris on silence/noise)
                const blacklist = [
                    "thank you for watching", 
                    "thanks for watching", 
                    "subtitles by", 
                    "amara.org", 
                    "please subscribe",
                    "watching!"
                ];
                
                const lowerEntry = newEntry.toLowerCase();
                if (blacklist.some(phrase => lowerEntry.includes(phrase))) {
                    loggerService.catDebug(LogCategory.SYSTEM, `Audio: Suppressing blacklisted hallucination: "${newEntry}"`);
                    return;
                }

                // Append and limit size
                const updatedTranscript = (state.runningTranscript + "\n" + newEntry).trim().split("\n").slice(-20).join("\n");

                sceneManager.updateAudio({
                    lastSpeaker: payload.speaker,
                    recognitionConfidence: confidence,
                    runningTranscript: updatedTranscript,
                    vocalEmotion: payload.vocal_emotion || 'neutral'
                });
            } else if (type === 'audio_metrics') {
                // IMPORTANT: payload.is_speaking from sidecar is MIC activity (User speaking)
                // voiceService.getIsSpeaking() is AI activity (System speaking)
                const isAiSpeaking = voiceService.getIsSpeaking();
                
                sceneManager.updateAudio({
                    rmsLevel: payload.rms,
                    isSpeaking: isAiSpeaking // Strictly AI activity for the UI indicator
                });
            }
        });
    }
}

export const audioStreamService = new AudioStreamService();
