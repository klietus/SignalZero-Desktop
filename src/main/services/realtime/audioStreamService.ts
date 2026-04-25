import { sceneManager } from './sceneManager.js';
import { eventBusService } from '../eventBusService.js';
import { KernelEventType } from '../../types.js';
import { voiceService } from './voiceProcess.js';
import { loggerService, LogCategory } from '../loggerService.js';
import { transcriptManager } from './transcriptManager.js';

class AudioStreamService {
    private isInitialized = false;

    constructor() {}

    public initialize() {
        if (this.isInitialized) return;
        this.isInitialized = true;
        // Listen to events from the event bus that the voice service might emit
        eventBusService.onKernelEvent(KernelEventType.CONTEXT_UPDATED, (raw) => {
            const data = raw as { type?: string; text?: string | undefined; metadata?: Record<string, unknown> };
            if (data.type === 'voice_wake_word_detected') {
                const state = sceneManager.getState().audio;
                const meta = data.metadata as Record<string, string> | undefined;
                const speaker = meta?.voice_authenticated_username || 'USER';
                const emotion = (meta?.vocal_emotion as string) || 'NEUTRAL';
                
                const lastEntry = state.transcript[state.transcript.length - 1];
                if (lastEntry && lastEntry.text === data.text && lastEntry.speaker === speaker.toUpperCase()) {
                    loggerService.catDebug(LogCategory.SYSTEM, "AudioStreamService: Wake word transcript already added via stt_result. Skipping duplicate.");
                    sceneManager.updateAudio({ isSpeaking: true });
                    return;
                }

                const text = data.text || '';
                const newEntryLine = `[${speaker.toUpperCase()} | ${emotion.toUpperCase()}]\n${text}`;
                const updatedTranscript = (state.runningTranscript + "\n" + newEntryLine).trim().split("\n").slice(-60).join("\n");

                const newEntryObj = {
                    speaker: speaker.toUpperCase(),
                    text: text,
                    emotion: emotion.toLowerCase(),
                    timestamp: Date.now()
                };

                transcriptManager.addEntry(speaker, text);

                sceneManager.updateAudio({
                    lastSpeaker: speaker,
                    runningTranscript: updatedTranscript,
                    transcript: [...state.transcript, newEntryObj].slice(-50),
                    isSpeaking: true
                });
            }
        });

        // Listen for AI completion to add to transcript
        eventBusService.onKernelEvent(KernelEventType.INFERENCE_COMPLETED, (raw) => {
            const data = raw as { fullText?: string };
            if (!data.fullText) return;
            const state = sceneManager.getState().audio;
            const newEntryLine = `[AI | NEUTRAL]\n${data.fullText}`;
            const updatedTranscript = (state.runningTranscript + "\n" + newEntryLine).trim().split("\n").slice(-60).join("\n");
            
            const newEntryObj = {
                speaker: 'AI',
                text: data.fullText,
                emotion: 'neutral',
                timestamp: Date.now()
            };

            transcriptManager.addEntry('AI', data.fullText, 'neutral');

            sceneManager.updateAudio({
                runningTranscript: updatedTranscript,
                transcript: [...state.transcript, newEntryObj].slice(-50)
            });
        });

        // Listen to direct sidecar messages via voiceService
        voiceService.on('message', (msg) => {
            const { type, payload } = msg;
            
            if (type === 'stt_result') {
                loggerService.catDebug(LogCategory.SYSTEM, `AudioStreamService: Processing stt_result: "${payload.text}"`);
                const state = sceneManager.getState().audio;
                const newEntryText = payload.text?.trim();
                const confidence = payload.score || 0;
                
                if (!newEntryText) {
                    loggerService.catDebug(LogCategory.SYSTEM, "AudioStreamService: Empty text in stt_result, skipping.");
                    return;
                }

                // --- HALLUCINATION FILTER ---
                if (confidence < 0.25) {
                    loggerService.catDebug(LogCategory.SYSTEM, `AudioStreamService: Suppressing low-confidence STT hallucination (${confidence}): "${newEntryText}"`);
                    return;
                }

                const blacklist = ["thank you for watching", "thanks for watching", "subtitles by", "amara.org", "please subscribe", "watching!"];
                const lowerEntry = newEntryText.toLowerCase();
                if (blacklist.some(phrase => lowerEntry.includes(phrase))) {
                    loggerService.catDebug(LogCategory.SYSTEM, `AudioStreamService: Suppressing blacklisted hallucination: "${newEntryText}"`);
                    return;
                }

                const speaker = (payload.speaker || 'USER').toUpperCase();
                const emotion = (payload.vocal_emotion || 'neutral').toUpperCase();
                const newEntryLine = `[${speaker} | ${emotion}]\n${newEntryText}`;

                // Append and limit size
                const updatedTranscript = (state.runningTranscript + "\n" + newEntryLine).trim().split("\n").slice(-60).join("\n");

                const newEntryObj = {
                    speaker,
                    text: newEntryText,
                    emotion: emotion.toLowerCase(),
                    timestamp: Date.now()
                };

                transcriptManager.addEntry(speaker, newEntryText, emotion);

                loggerService.catDebug(LogCategory.SYSTEM, `AudioStreamService: Updating transcript. New size: ${updatedTranscript.length} chars. Entry: "${newEntryLine}"`);

                sceneManager.updateAudio({
                    lastSpeaker: speaker,
                    recognitionConfidence: confidence,
                    runningTranscript: updatedTranscript,
                    transcript: [...state.transcript, newEntryObj].slice(-50),
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
