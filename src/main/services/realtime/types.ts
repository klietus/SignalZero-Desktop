
export interface AudioStreamState {
    lastSpeaker: string | null;
    recognitionConfidence: number;
    isSpeaking: boolean;
    rmsLevel: number;
    transcription: string;
}

export interface DetectedObject {
    label: string;
    confidence: number;
    bbox: [number, number, number, number]; // [x, y, w, h] or [x1, y1, x2, y2]
}

export interface PersonDetection {
    id: string;
    expression: string;
    attributes: Record<string, any>;
    bbox: [number, number, number, number];
}

export interface CameraStreamState {
    lastFrame: string | null; // Base64 or path to latest grab
    detectedObjects: DetectedObject[];
    people: PersonDetection[];
    timestamp: number;
}

export interface ScreenStreamState {
    lastFrame: string | null;
    activeApplication: string | null;
    ocrText: string;
    timestamp: number;
}

export interface StreamStatus {
    isActive: boolean;
    isError: boolean;
    errorMessage?: string;
}

export interface SceneState {
    audio: AudioStreamState & { status: StreamStatus };
    camera: CameraStreamState & { status: StreamStatus };
    screen: ScreenStreamState & { status: StreamStatus };
}

export interface RealtimeMessage {
    type: 'audio_update' | 'camera_update' | 'screen_update';
    payload: any;
}
