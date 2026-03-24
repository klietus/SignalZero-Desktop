import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { contextService } from '../services/contextService.js';
import { sqliteService } from '../services/sqliteService.js';

describe('ContextService Relational', () => {
    beforeEach(() => {
        sqliteService.__sqliteTestUtils.reset();
    });

    it('should create and retrieve a session', async () => {
        const session = await contextService.createSession('conversation', { theme: 'dark' }, 'Test Session');
        expect(session.id).toBeDefined();
        expect(session.name).toBe('Test Session');
        expect(session.metadata.theme).toBe('dark');

        const retrieved = await contextService.getSession(session.id);
        expect(retrieved).toEqual(session);
    });

    it('should record and retrieve history', async () => {
        const session = await contextService.createSession('conversation');
        
        await contextService.recordMessage(session.id, {
            role: 'user',
            content: 'Hello Kernel',
            timestamp: new Date().toISOString()
        });

        const history = await contextService.getHistory(session.id);
        expect(history).toHaveLength(1);
        expect(history[0].content).toBe('Hello Kernel');
    });

    it('should delete session and cascade messages', async () => {
        const session = await contextService.createSession('conversation');
        await contextService.recordMessage(session.id, { role: 'user', content: 'test' });
        
        await contextService.deleteSession(session.id);
        
        expect(await contextService.getSession(session.id)).toBeNull();
        const history = await contextService.getHistory(session.id);
        expect(history).toHaveLength(0);
    });
});
