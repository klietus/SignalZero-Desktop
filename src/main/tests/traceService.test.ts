import { describe, it, expect, beforeEach, vi } from 'vitest';
import { traceService } from '../services/traceService.js';
import { sqliteService } from '../services/sqliteService.js';
import { KernelEventType } from '../types.js';

vi.mock('../services/eventBusService.js', () => ({
    eventBusService: { 
        emitKernelEvent: vi.fn(), 
        on: vi.fn(), 
        onKernelEvent: vi.fn() 
    }
}));

describe('TraceService Relational', () => {
    beforeEach(async () => {
        sqliteService.__sqliteTestUtils.reset();
        const { eventBusService } = await import('../services/eventBusService.js');
        (eventBusService as any).emitKernelEvent.mockClear();
    });

    it('should add a trace and persist it to the traces table', async () => {
        sqliteService.run("INSERT INTO contexts (id, name) VALUES (?, ?)", ['sess-1', 'Session 1']);

        const trace: any = {
            id: 'tr-123',
            sessionId: 'sess-1',
            entry_node: 'USER:test',
            status: 'complete',
            activation_path: [],
            source_context: { symbol_domain: 'root', trigger_vector: 'test' }
        };

        await traceService.addTrace(trace);
        
        const retrieved = await traceService.getTrace('tr-123');
        expect(retrieved).not.toBeNull();
        expect(retrieved?.id).toBe('tr-123');
        expect(retrieved?.sessionId).toBe('sess-1');
    });

    it('should emit a KernelEvent when a trace is logged', async () => {
        const { eventBusService } = await import('../services/eventBusService.js');
        const emitSpy = (eventBusService as any).emitKernelEvent;
        emitSpy.mockClear();
        
        const trace: any = {
            id: 'tr-456',
            status: 'complete',
            activation_path: [],
            source_context: { symbol_domain: 'root', trigger_vector: 'test' }
        };

        await traceService.addTrace(trace);
        
        const traceLoggedCalls = emitSpy.mock.calls.filter(
            call => call[0] === KernelEventType.TRACE_LOGGED
        );
        expect(traceLoggedCalls).toHaveLength(1);
        expect(traceLoggedCalls[0][1].trace.id).toBe('tr-456');
    });
});
