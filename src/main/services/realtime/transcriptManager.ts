export interface TranscriptEntry {
    speaker: string;
    text: string;
    emotion: string;
    timestamp: number;
    id: number;
}

export class TranscriptManager {
    private static instance: TranscriptManager;
    private entries: TranscriptEntry[] = [];
    private lastGrabbedId = 0;
    private nextId = 1;
    private static MAX_LINES = 40;

    private constructor() {}

    static getInstance(): TranscriptManager {
        if (!this.instance) {
            this.instance = new TranscriptManager();
        }
        return this.instance;
    }

    addEntry(speaker: string, text: string, emotion: string = 'neutral') {
        const cleanText = text?.trim();
        if (!cleanText) return;

        const cleanSpeaker = (speaker || 'USER').toUpperCase();
        
        // USER REQUEST: "I dont want the AI added to the rolling buffer, it would use up large blocks of it uselessly."
        if (cleanSpeaker === 'AI') return;

        this.entries.push({
            speaker: cleanSpeaker,
            text: cleanText,
            emotion: emotion.toLowerCase(),
            timestamp: Date.now(),
            id: this.nextId++
        });

        // Limit local history to prevent memory growth
        if (this.entries.length > 100) {
            this.entries.shift();
        }
    }

    getRunningTranscript(): string {
        // Each entry takes 2 lines in the UI parser logic: [SPEAKER | EMOTION]\nText
        const entriesToDisplay = this.entries.slice(-(TranscriptManager.MAX_LINES / 2));
        
        return entriesToDisplay
            .map(e => `[${e.speaker} | ${e.emotion.toUpperCase()}]\n${e.text}`)
            .join('\n');
    }

    /**
     * Incremental USER-ONLY grab for analysis.
     */
    getNewUserEntriesForAnalysis(): string {
        const newEntries = this.entries.filter(e => 
            e.speaker === 'USER' && e.id > this.lastGrabbedId
        );
        
        if (newEntries.length > 0) {
            this.lastGrabbedId = newEntries[newEntries.length - 1].id;
        }

        return newEntries.map(e => e.text).join('\n');
    }

    /**
     * Aggregates recent messages from the same speaker within a time window (e.g., 10 seconds).
     * Useful for wake-word routing where the user might have spoken in multiple chunks.
     */
    getSpeakerContext(speaker: string, windowMs = 15000): string {
        const cleanSpeaker = (speaker || 'USER').toUpperCase();
        const now = Date.now();
        
        const recentEntries = this.entries.filter(e => 
            e.speaker === cleanSpeaker && (now - e.timestamp) <= windowMs
        );
        
        return recentEntries.map(e => e.text).join(' ');
    }

    /**
     * Internal testing utility to clear state
     */
    resetForTest() {
        this.entries = [];
        this.lastGrabbedId = 0;
        this.nextId = 1;
    }

    static isHallucination(text: string, score: number): boolean {
        // 1. Confidence Threshold (Whisper hallucinations are often very low confidence)
        if (score < 0.25) return true;

        // 2. Common Phrase Blacklist (Classic Whisper debris on silence/noise)
        const blacklist = [
            "thank you for watching", 
            "thanks for watching", 
            "subtitles by", 
            "amara.org", 
            "please subscribe",
            "watching!"
        ];
        
        const lowerEntry = text.toLowerCase();
        return blacklist.some(phrase => lowerEntry.includes(phrase));
    }
}

export const transcriptManager = TranscriptManager.getInstance();
