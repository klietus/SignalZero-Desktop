import { EventEmitter } from 'events';
import { SceneState, AudioStreamState, CameraStreamState, ScreenStreamState, StreamStatus } from './types.js';

class SceneManager extends EventEmitter {
    private state: SceneState = {
        audio: {
            lastSpeaker: null,
            recognitionConfidence: 0,
            isSpeaking: false,
            rmsLevel: 0,
            transcription: "",
            status: { isActive: false, isError: false }
        },
        camera: {
            lastFrame: null,
            detectedObjects: [],
            people: [],
            timestamp: 0,
            status: { isActive: false, isError: false }
        },
        screen: {
            lastFrame: null,
            activeApplication: null,
            ocrText: "",
            timestamp: 0,
            status: { isActive: false, isError: false }
        }
    };

    constructor() {
        super();
    }

    updateStatus(type: 'audio' | 'camera' | 'screen', status: Partial<StreamStatus>) {
        this.state[type].status = { ...this.state[type].status, ...status };
        this.emit('update', { type, state: this.state[type] });
        this.emit('status-change', { type, status: this.state[type].status });
    }

    updateAudio(update: Partial<AudioStreamState>) {
        this.state.audio = { ...this.state.audio, ...update };
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
