
export interface TranscriptEntry {
    speaker: string;
    text: string;
    emotion: string;
    timestamp: number;
}

export interface AudioStreamState {
    lastSpeaker: string | null;
    recognitionConfidence: number;
    isSpeaking: boolean;
    rmsLevel: number;
    runningTranscript: string;
    transcript: TranscriptEntry[];
    vocalEmotion: string;
}

export interface PersonDetection {
    id: string;
    expression: string;
    attributes: Record<string, any>;
    bbox: [number, number, number, number];
}

export interface CameraStreamState {
    lastFrame: string | null; // Base64 or path to latest grab
    people: PersonDetection[];
    hasPeople: boolean;
    timestamp: number;
}

export interface ScreenStreamState {
    lastFrame: string | null;
    activeApplication: string | null;
    timestamp: number;
}

export interface StreamStatus {
    isActive: boolean;
    isError: boolean;
    errorMessage?: string;
}

export interface AutonomousState {
    lastSpikeReason: string | null;
    isProcessingFlashRound: boolean;
    recentSpikeTimeline: { timestamp: number, reason: string }[];
}

export interface SceneState {
    audio: AudioStreamState & { status: StreamStatus };
    camera: CameraStreamState & { status: StreamStatus };
    screen: ScreenStreamState & { status: StreamStatus };
    autonomous: AutonomousState;
}

export interface RealtimeMessage {
    type: 'audio_update' | 'camera_update' | 'screen_update';
    payload: any;
}
