import { describe, it, expect } from 'vitest';
import { stripThoughts } from '../services/inferenceService.js';

describe('InferenceService Utilities', () => {
    describe('stripThoughts', () => {
        it('should strip <thought> tags', () => {
            const text = 'Hello <thought>I am thinking</thought> world';
            const result = stripThoughts(text);
            expect(result).toBe('Hello world');
        });

        it('should strip <think> tags', () => {
            const text = 'Hello <think>I am thinking</think> world';
            const result = stripThoughts(text);
            expect(result).toBe('Hello world');
        });

        it('should handle unclosed <think> tags', () => {
            const text = 'Hello <think>I am thinking';
            const result = stripThoughts(text);
            expect(result).toBe('Hello');
        });

        it('should strip sz-think links', () => {
            const text = 'Hello [Thinking...](sz-think:thinking) world';
            const result = stripThoughts(text);
            expect(result).toBe('Hello world');
        });

        it('should handle empty or null input', () => {
            expect(stripThoughts('')).toBe('');
            expect(stripThoughts(null as any)).toBe('');
        });
    });
});
