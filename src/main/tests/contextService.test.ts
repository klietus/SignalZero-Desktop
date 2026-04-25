import { describe, it, expect, beforeEach, vi } from 'vitest';
import { contextService } from '../services/contextService.js';
import { sqliteService } from '../services/sqliteService.js';
import { eventBusService } from '../services/eventBusService.js';
import { KernelEventType } from '../types.js';

describe('ContextService Relational', () => {
    beforeEach(() => {
        sqliteService.__sqliteTestUtils.reset();
    });

    it('should create and retrieve a session', async () => {
        const session = await contextService.createSession('conversation', { theme: 'dark' }, 'Test Session');
        expect(session.id).toBeDefined();
        expect(session.name).toBe('Test Session');
        expect(session.metadata?.theme).toBe('dark');

        const retrieved = await contextService.getSession(session.id);
        expect(retrieved).toEqual(session);
    });

    it('should emit context:created event with session in payload.session', async () => {
        const emitSpy = vi.spyOn(eventBusService, 'emitKernelEvent');
        const session = await contextService.createSession('conversation', {}, 'EventTest');
        
        expect(emitSpy).toHaveBeenCalledWith(KernelEventType.CONTEXT_CREATED, { session });
        
        // Verify the payload shape matches what the renderer expects
        const payload = emitSpy.mock.calls[0][1] as any;
        expect(payload.session).toBeDefined();
        expect(payload.session.id).toBe(session.id);
        expect(payload.session.name).toBe('EventTest');
    });

    it('should record and retrieve history', async () => {
        const session = await contextService.createSession('conversation');
        
        await contextService.recordMessage(session.id, {
            id: 'm1',
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
        await contextService.recordMessage(session.id, { id: 'm2', role: 'user', content: 'test', timestamp: new Date().toISOString() });
        
        await contextService.deleteSession(session.id);
        
        expect(await contextService.getSession(session.id)).toBeNull();
        const history = await contextService.getHistory(session.id);
        expect(history).toHaveLength(0);
    });
});
