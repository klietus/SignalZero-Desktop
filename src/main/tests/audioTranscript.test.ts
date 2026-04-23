import { describe, it, expect, beforeEach } from 'vitest';
import { transcriptManager } from '../services/realtime/transcriptManager.js';

describe('TranscriptManager', () => {
    beforeEach(() => {
        transcriptManager.resetForTest();
    });

    it('should maintain a rolling history of 40 lines (max 20 user entries)', () => {
        // Add 30 entries (60 lines if they were added)
        for (let i = 0; i < 30; i++) {
            transcriptManager.addEntry('USER', `Message ${i}`, 'neutral');
        }
        
        const transcript = transcriptManager.getRunningTranscript();
        const lines = transcript.split('\n');
        // MAX_LINES is 40. Each entry is 2 lines. So 20 entries max.
        expect(lines.length).toBeLessThanOrEqual(40);
        expect(transcript).toContain('Message 29');
        expect(transcript).not.toContain('Message 0');
        expect(transcript).toContain('[USER | NEUTRAL]');
    });

    it('should filter out AI speech from the rolling buffer', () => {
        transcriptManager.addEntry('USER', 'User message', 'happy');
        transcriptManager.addEntry('AI', 'AI message', 'neutral');
        
        const transcript = transcriptManager.getRunningTranscript();
        expect(transcript).toContain('User message');
        expect(transcript).toContain('[USER | HAPPY]');
        expect(transcript).not.toContain('AI message');
    });

    it('should track last grabbed timestamp for analysis', () => {
        // Add some messages
        transcriptManager.addEntry('USER', 'Analysis 1', 'neutral');
        transcriptManager.addEntry('USER', 'Analysis 2', 'neutral');
        
        const firstGrab = transcriptManager.getNewUserEntriesForAnalysis();
        expect(firstGrab).toContain('Analysis 1');
        expect(firstGrab).toContain('Analysis 2');
        
        const secondGrabImmediate = transcriptManager.getNewUserEntriesForAnalysis();
        expect(secondGrabImmediate).toBe(""); // Nothing new
        
        transcriptManager.addEntry('USER', 'Analysis 3', 'neutral');
        const thirdGrab = transcriptManager.getNewUserEntriesForAnalysis();
        expect(thirdGrab).toBe('Analysis 3');
        expect(thirdGrab).not.toContain('Analysis 1');
    });

    it('should only include USER entries in analysis grab', () => {
        transcriptManager.addEntry('USER', 'User for analysis', 'neutral');
        transcriptManager.addEntry('AI', 'AI hidden', 'neutral');
        
        const grab = transcriptManager.getNewUserEntriesForAnalysis();
        expect(grab).toContain('User for analysis');
        expect(grab).not.toContain('AI hidden');
    });
});
