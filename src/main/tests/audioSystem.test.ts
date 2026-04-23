import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1. Mock Electron
vi.mock('electron', () => ({
    app: {
        getPath: vi.fn().mockReturnValue('/tmp/signalzero-test'),
        getAppPath: vi.fn().mockReturnValue('/Users/klietus/workspace/LocalNode/SignalZero-Desktop'),
        isPackaged: false,
        commandLine: {
            appendSwitch: vi.fn()
        }
    },
    ipcMain: {
        handle: vi.fn(),
        on: vi.fn()
    },
    systemPreferences: {
        askForMediaAccess: vi.fn().mockResolvedValue(true)
    },
    BrowserWindow: class { 
        loadURL = vi.fn();
        webContents = { send: vi.fn() };
    },
    Menu: {
        buildFromTemplate: vi.fn(),
        setApplicationMenu: vi.fn()
    },
    Tray: class {
        setToolTip = vi.fn();
        setContextMenu = vi.fn();
    },
    nativeImage: {
        createFromPath: vi.fn()
    },
    shell: {
        openExternal: vi.fn()
    },
    desktopCapturer: {
        getSources: vi.fn()
    }
}));

// 2. Mock uiStateService
vi.mock('../services/uiStateService.js', () => ({
    uiStateService: {
        broadcast: vi.fn(),
        activeSessionId: 'test-session-id',
        setActiveSessionId: vi.fn()
    }
}));

// Mock index.ts broadcast
vi.mock('../../index.js', () => ({
    broadcast: vi.fn(),
    activeSessionId: 'test-session-id'
}));

// 3. Mock other services
vi.mock('../services/contextService.js', () => ({
    contextService: {
        hasActiveMessage: vi.fn().mockResolvedValue(false)
    }
}));

vi.mock('../services/settingsService.js', () => ({
    settingsService: {
        get: vi.fn().mockResolvedValue({ voiceEnabled: true }),
        getInferenceSettings: vi.fn().mockResolvedValue({}),
        update: vi.fn()
    }
}));

// Import the services we're testing
import { voiceService } from '../services/realtime/voiceProcess.js';
import { audioStreamService } from '../services/realtime/audioStreamService.js';
import { transcriptManager } from '../services/realtime/transcriptManager.js';
import { sceneManager } from '../services/realtime/sceneManager.js';
import { uiStateService } from '../services/uiStateService.js';

describe('Audio System Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        audioStreamService.initialize();
        transcriptManager.resetForTest();
        sceneManager.updateAudio({ runningTranscript: "", transcript: [], lastSpeaker: null });
        // Force system name for test consistency
        (voiceService as any).systemName = "axiom";
        (voiceService as any).isSpeaking = false;
        // Mock activeSessionId property
        vi.mocked(uiStateService).activeSessionId = 'test-session-id' as any;
    });

    it('should process a standard stt_result correctly', async () => {
        const payload = {
            text: "Hello, how is the weather?",
            speaker: "Brett",
            score: 0.9,
            vocal_emotion: "neutral",
            timestamp: "12:00:00"
        };

        // Simulate sidecar message correctly to trigger internal routing logic
        await (voiceService as any).handleSidecarMessage({ type: 'stt_result', payload });

        // Verify transcript populated
        const transcript = transcriptManager.getRunningTranscript();
        expect(transcript).toContain("[BRETT | NEUTRAL]");
        expect(transcript).toContain("Hello, how is the weather?");

        // Verify sceneManager updated
        const state = sceneManager.getState().audio;
        expect(state.runningTranscript).toBe(transcript);
        expect(state.lastSpeaker).toBe("BRETT");
        expect(state.transcript.length).toBe(1);
        expect(state.transcript[0].emotion).toBe('neutral');
    });

    it('should detect the wake word and route to AI', async () => {
        const payload = {
            text: "Axiom, what is my name?",
            speaker: "Brett",
            score: 0.95,
            vocal_emotion: "happy"
        };

        await (voiceService as any).handleSidecarMessage({ type: 'stt_result', payload });

        // Verify broadcast was called for routing
        expect(uiStateService.broadcast).toHaveBeenCalledWith('voice:trigger-submit', expect.objectContaining({
            text: "Axiom, what is my name?",
            speaker: "Brett"
        }));
    });

    it('should aggregate context for the same speaker upon wake word detection', async () => {
        // 1. Send first message (no wake word)
        await (voiceService as any).handleSidecarMessage({ type: 'stt_result', payload: {
            text: "I am working on a new project.",
            speaker: "Brett",
            score: 0.9,
            vocal_emotion: "neutral"
        }});

        // 2. Send second message (no wake word)
        await (voiceService as any).handleSidecarMessage({ type: 'stt_result', payload: {
            text: "It involves some complex math.",
            speaker: "Brett",
            score: 0.9,
            vocal_emotion: "neutral"
        }});

        // 3. Send third message (WITH wake word)
        await (voiceService as any).handleSidecarMessage({ type: 'stt_result', payload: {
            text: "Axiom, can you help me with this?",
            speaker: "Brett",
            score: 0.9,
            vocal_emotion: "happy"
        }});

        // Verify the ROUTED text is aggregated
        expect(uiStateService.broadcast).toHaveBeenCalledWith('voice:trigger-submit', expect.objectContaining({
            text: "I am working on a new project. It involves some complex math. Axiom, can you help me with this?",
            speaker: "Brett"
        }));
    });

    it('should NOT aggregate context from different speakers', async () => {
        // 1. Brett speaks
        await (voiceService as any).handleSidecarMessage({ type: 'stt_result', payload: {
            text: "Brett is talking.",
            speaker: "Brett",
            score: 0.9,
            vocal_emotion: "neutral"
        }});

        // 2. Alice speaks
        await (voiceService as any).handleSidecarMessage({ type: 'stt_result', payload: {
            text: "Axiom, route Alice.",
            speaker: "Alice",
            score: 0.9,
            vocal_emotion: "neutral"
        }});

        // Verify Alice's trigger ONLY contains Alice's text
        expect(uiStateService.broadcast).toHaveBeenCalledWith('voice:trigger-submit', expect.objectContaining({
            text: "Axiom, route Alice.",
            speaker: "Alice"
        }));
    });

    it('should filter out AI echo (stt_result while AI is speaking)', async () => {
        // Mock voiceService to report it IS speaking
        (voiceService as any).isSpeaking = true;

        await (voiceService as any).handleSidecarMessage({ type: 'stt_result', payload: {
            text: "AI is hearing itself speak.",
            speaker: "GUEST_1",
            score: 0.9,
            vocal_emotion: "neutral"
        }});

        expect(transcriptManager.getRunningTranscript()).toBe("");
        expect(uiStateService.broadcast).not.toHaveBeenCalledWith('voice:trigger-submit', expect.any(Object));
    });

    it('should ignore wake words if no active session is found', async () => {
        // Clear active session
        (uiStateService as any).activeSessionId = null;

        await (voiceService as any).handleSidecarMessage({ type: 'stt_result', payload: {
            text: "Axiom, help me.",
            speaker: "Brett",
            score: 0.9,
            vocal_emotion: "neutral"
        }});

        expect(uiStateService.broadcast).not.toHaveBeenCalledWith('voice:trigger-submit', expect.any(Object));
    });

    it('should handle hallucination filtering in the integrated flow', async () => {
        await (voiceService as any).handleSidecarMessage({ type: 'stt_result', payload: {
            text: "Thank you for watching.",
            speaker: "USER",
            score: 0.9,
            vocal_emotion: "neutral"
        }});

        expect(transcriptManager.getRunningTranscript()).toBe("");
    });
});
