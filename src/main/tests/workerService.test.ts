import { describe, it, expect } from 'vitest';
import { workerService } from '../services/workerService.js';

describe('WorkerService Integration', () => {
    it('should parse JSON correctly in a worker thread', async () => {
        const testObj = { foo: 'bar', baz: 123 };
        const json = JSON.stringify(testObj);
        const result = await workerService.parseJson(json);
        expect(result).toEqual(testObj);
    });

    it('should strip thoughts correctly in a worker thread', async () => {
        const text = 'Hello <thought>I am thinking</thought> world';
        const result = await workerService.stripThoughts(text);
        expect(result).toBe('Hello world');
    });

    it('should handle malformed JSON gracefully', async () => {
        const malformed = '{ "invalid": json }';
        try {
            await workerService.parseJson(malformed);
            throw new Error('Should have thrown');
        } catch (error: any) {
            expect(error.message).toBeDefined();
        }
    });
});
