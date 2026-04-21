import { sceneManager } from './sceneManager.js';
import { realtimeService } from './realtimeService.js';
import { inferenceService } from '../inferenceService.js';
import { eventBusService } from '../eventBusService.js';
import { loggerService, LogCategory } from '../loggerService.js';
import { settingsService } from '../settingsService.js';
import { activeSessionId } from '../../index.js';
import { voiceService } from './voiceProcess.js';

interface SceneSnapshot {
    timestamp: number;
    audio: any;
    camera: any;
    screen: any;
}

interface TriggerStrategy {
    name: string;
    evaluate(window: SceneSnapshot[]): string | null;
}

class VisualEmotionStrategy implements TriggerStrategy {
    name = "Visual Emotion";
    evaluate(window: SceneSnapshot[]): string | null {
        if (window.length < 6) return null; // Need at least 6s of data

        // Split window to see shift
        const mid = Math.floor(window.length / 2);
        const firstHalf = window.slice(0, mid);
        const secondHalf = window.slice(mid);

        const getDominant = (snapshots: SceneSnapshot[]) => {
            const counts: Record<string, number> = {};
            snapshots.forEach(s => {
                const expr = s.camera.people[0]?.expression || 'neutral';
                counts[expr] = (counts[expr] || 0) + 1;
            });
            return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
        };

        const domPrev = getDominant(firstHalf);
        const domLatest = getDominant(secondHalf);

        if (domLatest !== 'neutral' && domLatest !== domPrev) {
            return `Dominant Emotion Shift: ${domPrev} -> ${domLatest}`;
        }
        return null;
    }
}

class AcousticProsodyStrategy implements TriggerStrategy {
    name = "Acoustic Prosody";
    evaluate(window: SceneSnapshot[]): string | null {
        if (window.length < 6) return null;

        const mid = Math.floor(window.length / 2);
        const firstHalf = window.slice(0, mid);
        const secondHalf = window.slice(mid);

        const getDominant = (snapshots: SceneSnapshot[]) => {
            const counts: Record<string, number> = {};
            snapshots.forEach(s => {
                const expr = s.audio.vocalEmotion || 'neutral';
                counts[expr] = (counts[expr] || 0) + 1;
            });
            return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
        };

        const domPrev = getDominant(firstHalf);
        const domLatest = getDominant(secondHalf);

        if (domLatest !== 'neutral' && domLatest !== domPrev) {
            return `Dominant Acoustic Shift: ${domPrev} -> ${domLatest}`;
        }
        return null;
    }
}

class AppContextStrategy implements TriggerStrategy {
    name = "App Context";
    evaluate(window: SceneSnapshot[]): string | null {
        if (window.length < 2) return null;
        const latest = window[window.length - 1].screen;
        const previous = window[window.length - 2].screen;
        if (latest.activeApplication !== previous.activeApplication) {
            return `App Switch: ${latest.activeApplication}`;
        }
        return null;
    }
}

class PerceptionTriggerService {
    private window: SceneSnapshot[] = [];
    private readonly WINDOW_SIZE_MS = 15000;
    private isProcessingFlashRound = false;
    
    // Debounce / Normalization state
    private lastFiredReason: string | null = null;
    private lastFiredTime = 0;
    private readonly REASON_DEBOUNCE_MS = 30000; // Don't fire same reason for 30s

    private strategies: TriggerStrategy[] = [
        new VisualEmotionStrategy(),
        new AcousticProsodyStrategy(),
        new AppContextStrategy()
    ];

    constructor() {
        this.initialize();
    }

    private initialize() {
        // Sample the scene every 1 second for the sliding window
        setInterval(() => this.takeSnapshot(), 1000);
    }

    private takeSnapshot() {
        const fullState = sceneManager.getState();
        // If no one is around, don't even bother tracking context
        if (fullState.camera.status.isActive && !fullState.camera.hasPeople) {
            this.window = [];
            return;
        }

        const snapshot: SceneSnapshot = {
            timestamp: Date.now(),
            audio: { ...fullState.audio },
            camera: { ...fullState.camera },
            screen: { ...fullState.screen }
        };

        // Deep-ish copy of snapshots but remove heavy frames to keep memory low
        delete snapshot.camera.lastFrame;
        delete snapshot.screen.lastFrame;

        this.window.push(snapshot);

        // Remove old samples
        const cutoff = Date.now() - this.WINDOW_SIZE_MS;
        this.window = this.window.filter(s => s.timestamp > cutoff);

        this.evaluateSpikes();
    }

    private async evaluateSpikes() {
        if (this.isProcessingFlashRound || this.window.length < 6) return;

        // SKIP evaluation if AI is currently speaking to avoid feedback loops or interruptions
        if (voiceService.getIsSpeaking()) {
            return;
        }

        let detectedReason: string | null = null;
        
        // Execute all evaluation strategies to find candidate spikes
        for (const strategy of this.strategies) {
            const reason = strategy.evaluate(this.window);
            if (reason) {
                detectedReason = reason;
                break; 
            }
        }

        if (!detectedReason) return;

        // --- Normalization & Debounce ---
        const now = Date.now();
        
        // Reason-based Debounce (Prevent rapid re-firing of same exact cause)
        if (detectedReason === this.lastFiredReason && (now - this.lastFiredTime < this.REASON_DEBOUNCE_MS)) {
            return;
        }

        // Final verification: we use the spikeThreshold to decide how often we can trigger
        const settings = await settingsService.getRealtimeAssistanceSettings();
        if (!settings.enabled) return;

        // Valid spike detected via distribution shift
        this.lastFiredReason = detectedReason;
        this.lastFiredTime = now;

        sceneManager.updateAutonomous({ 
            lastSpikeReason: detectedReason,
            recentSpikeTimeline: [
                { timestamp: now, reason: detectedReason },
                ...sceneManager.getState().autonomous.recentSpikeTimeline
            ].slice(0, 5)
        });

        this.triggerFlashRound(detectedReason);
    }

    private async triggerFlashRound(reason: string) {
        this.isProcessingFlashRound = true;
        sceneManager.updateAutonomous({ isProcessingFlashRound: true });
        loggerService.catInfo(LogCategory.SYSTEM, `PERCEPTION SPIKE DETECTED: ${reason}. Executing Flash Round...`);

        try {
            // 1. Prepare high-fidelity scene context (pixels + metadata)
            const sceneSnapshot = realtimeService.getSnapshot();
            const sceneAttachments: any[] = [];
            
            if (sceneSnapshot) {
                if (sceneSnapshot.camera?.lastFrame) {
                    const raw = sceneSnapshot.camera.lastFrame;
                    sceneAttachments.push({
                        mime_type: 'image/jpeg',
                        image_base64: raw.includes(',') ? raw.split(',')[1] : raw,
                        filename: 'camera_perception.jpg'
                    });
                    delete sceneSnapshot.camera.lastFrame;
                }
                if (sceneSnapshot.screen?.lastFrame) {
                    const raw = sceneSnapshot.screen.lastFrame;
                    sceneAttachments.push({
                        mime_type: 'image/jpeg',
                        image_base64: raw.includes(',') ? raw.split(',')[1] : raw,
                        filename: 'screen_perception.jpg'
                    });
                    delete sceneSnapshot.screen.lastFrame;
                }
            }

            const transcriptSlice = this.window
                .map(s => s.audio.runningTranscript || "")
                .filter(t => t && t.length > 0)
                .slice(-3)
                .join("\n---\n");

            const prompt = `
[SYSTEM_AUDIT_MODE]
You are the kernel's subconscious perception layer.
Reason over the provided contextual slice (metadata and multimodal frames).

Spike Reason: ${reason}
Recent Transcription:
${transcriptSlice}
Structured Scene Metadata:
${JSON.stringify(sceneSnapshot, null, 2)}

TASK: Determine if the user requires PROACTIVE assistance based on this event.
CRITERIA: Only promote if there is a concrete problem to solve (bug, confusion, etc) or a critical observation.
FORMAT: Return a JSON object with:
{
  "promote": boolean,
  "synthesis": "Brief 1-sentence observation",
  "reason": "Choice justification"
}
`.trim();

            // 2. Execute Flash Round via correct pattern
            const flashResult = await inferenceService.callFastInference([{ role: 'user', content: prompt }], 1024, sceneAttachments);

            if (flashResult) {
                const result = await inferenceService.extractJson(flashResult);
                if (result.promote === true) {
                    loggerService.catInfo(LogCategory.SYSTEM, `PROMOTING PERCEPTION EVENT: ${result.synthesis}`);
                    eventBusService.emitKernelEvent('perception:spike-promoted' as any, {
                        synthesis: result.synthesis,
                        reason: result.reason,
                        sceneSnapshot: sceneSnapshot,
                        transcriptSlice,
                        sessionId: activeSessionId
                    });
                }
 else {
                    loggerService.catDebug(LogCategory.SYSTEM, `Flash Round Ignored Spike: ${result.reason}`);
                }
            }

        } catch (e: any) {
            loggerService.catError(LogCategory.SYSTEM, "Flash Round Failed", { error: e.message });
        } finally {
            // Cooldown to prevent flooding
            setTimeout(() => { 
                this.isProcessingFlashRound = false; 
                sceneManager.updateAutonomous({ isProcessingFlashRound: false });
            }, 30000);
        }
    }
}

export const perceptionTriggerService = new PerceptionTriggerService();
