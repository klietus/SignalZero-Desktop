import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { traceService } from '../services/traceService.js';
import { sqliteService } from '../services/sqliteService.js';
import { eventBusService, KernelEventType } from '../services/eventBusService.js';

describe('TraceService Relational', () => {
    beforeEach(() => {
        sqliteService.__sqliteTestUtils.reset();
        vi.clearAllMocks();
    });

    it('should add a trace and persist it to the traces table', async () => {
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
        const emitSpy = vi.spyOn(eventBusService, 'emitKernelEvent');
        const trace: any = {
            id: 'tr-456',
            status: 'complete',
            activation_path: [],
            source_context: { symbol_domain: 'root', trigger_vector: 'test' }
        };

        await traceService.addTrace(trace);
        
        expect(emitSpy).toHaveBeenCalledWith(KernelEventType.TRACE_LOGGED, expect.objectContaining({
            id: 'tr-456'
        }));
    });
});
