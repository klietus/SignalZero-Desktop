import { EventEmitter } from 'events';
import { SceneState, AudioStreamState, CameraStreamState, ScreenStreamState, StreamStatus, AutonomousState } from './types.js';
import { loggerService, LogCategory } from '../loggerService.js';

class SceneManager extends EventEmitter {
    private state: SceneState = {
        audio: {
            lastSpeaker: null,
            recognitionConfidence: 0,
            isSpeaking: false,
            rmsLevel: 0,
            runningTranscript: "",
            transcript: [],
            vocalEmotion: "neutral",
            status: { isActive: false, isError: false }
        },
        camera: {
            lastFrame: null,
            people: [],
            hasPeople: false,
            timestamp: 0,
            status: { isActive: false, isError: false }
        },
        screen: {
            lastFrame: null,
            activeApplication: null,
            timestamp: 0,
            status: { isActive: false, isError: false }
        },
        autonomous: {
            lastSpikeReason: null,
            isProcessingFlashRound: false,
            recentSpikeTimeline: []
        }
    };

    constructor() {
        super();
    }

    updateAutonomous(update: Partial<AutonomousState>) {
        this.state.autonomous = { ...this.state.autonomous, ...update };
        this.emit('update', { type: 'autonomous', state: this.state.autonomous });
    }

    updateStatus(type: 'audio' | 'camera' | 'screen', status: Partial<StreamStatus>) {
        this.state[type].status = { ...this.state[type].status, ...status };
        this.emit('update', { type, state: this.state[type] });
        this.emit('status-change', { type, status: this.state[type].status });
    }

    updateAudio(update: Partial<AudioStreamState>) {
        this.state.audio = { ...this.state.audio, ...update };
        if (update.runningTranscript) {
            const transcriptLines = this.state.audio.runningTranscript.split('\n').length;
            loggerService.catDebug(LogCategory.SYSTEM, `SceneManager: Audio transcript updated. Total lines: ${transcriptLines}`);
        }
        this.emit('update', { type: 'audio', state: this.state.audio });
    }

    updateCamera(update: Partial<CameraStreamState>) {
        this.state.camera = { ...this.state.camera, ...update };
        this.emit('update', { type: 'camera', state: this.state.camera });
    }

    updateScreen(update: Partial<ScreenStreamState>) {
        this.state.screen = { ...this.state.screen, ...update };
        this.emit('update', { type: 'screen', state: this.state.screen });
    }

    getState(): SceneState {
        return this.state;
    }
}

export const sceneManager = new SceneManager();
