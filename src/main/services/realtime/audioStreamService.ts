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
                const state = sceneManager.getState().audio;
                const speaker = data.metadata?.voice_authenticated_username || 'USER';
                const newEntry = `[${speaker.toUpperCase()}]\n${data.text}`;
                
                const updatedTranscript = (state.runningTranscript + "\n" + newEntry).trim().split("\n").slice(-40).join("\n");

                sceneManager.updateAudio({
                    lastSpeaker: speaker,
                    runningTranscript: updatedTranscript,
                    isSpeaking: true
                });
            }
        });

        // Listen for AI completion to add to transcript
        eventBusService.onKernelEvent(KernelEventType.INFERENCE_COMPLETED, (data) => {
            if (!data.fullText) return;
            const state = sceneManager.getState().audio;
            const newEntry = `[AI]\n${data.fullText}`;
            const updatedTranscript = (state.runningTranscript + "\n" + newEntry).trim().split("\n").slice(-40).join("\n");
            
            sceneManager.updateAudio({
                runningTranscript: updatedTranscript
            });
        });

        // Listen to direct sidecar messages via voiceService
        voiceService.on('message', (msg) => {
            const { type, payload } = msg;
            
            if (type === 'stt_result') {
                const state = sceneManager.getState().audio;
                const newEntryText = payload.text?.trim();
                const confidence = payload.score || 0;
                
                if (!newEntryText) return;

                // --- HALLUCINATION FILTER ---
                // 1. Confidence Threshold (Whisper hallucinations are often very low confidence)
                if (confidence < 0.25) {
                    loggerService.catDebug(LogCategory.SYSTEM, `Audio: Suppressing low-confidence STT hallucination (${confidence}): "${newEntryText}"`);
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
                
                const lowerEntry = newEntryText.toLowerCase();
                if (blacklist.some(phrase => lowerEntry.includes(phrase))) {
                    loggerService.catDebug(LogCategory.SYSTEM, `Audio: Suppressing blacklisted hallucination: "${newEntryText}"`);
                    return;
                }

                const speaker = (payload.speaker || 'USER').toUpperCase();
                const newEntry = `[${speaker}]\n${newEntryText}`;

                // Append and limit size
                const updatedTranscript = (state.runningTranscript + "\n" + newEntry).trim().split("\n").slice(-40).join("\n");

                sceneManager.updateAudio({
                    lastSpeaker: speaker,
                    recognitionConfidence: confidence,
                    runningTranscript: updatedTranscript,
                    vocalEmotion: payload.vocal_emotion || 'neutral'
                });
            } else if (type === 'audio_metrics') {
                // IMPORTANT: payload.rms from sidecar
                const isAiSpeaking = voiceService.getIsSpeaking();
                
                sceneManager.updateAudio({
                    rmsLevel: payload.rms || 0,
                    isSpeaking: isAiSpeaking // Strictly AI activity for the UI indicator
                });
            }
        });
    }
}

export const audioStreamService = new AudioStreamService();
