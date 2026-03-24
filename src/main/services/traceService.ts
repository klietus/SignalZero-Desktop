import { sqliteService } from './sqliteService.js';
import { loggerService } from './loggerService.js';
import { TraceData } from '../types.js';
import { eventBusService, KernelEventType } from './eventBusService.js';
import { getDayBucketKey } from './timeService.js';

const TRACE_INDEX_KEY = 'trace:index';
const sessionTracesKey = (id: string) => `trace:session:${id}`;

export const traceService = {
    async addTrace(trace: TraceData): Promise<void> {
        const id = trace.id || `tr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        trace.id = id;
        if (!trace.created_at) trace.created_at = new Date().toISOString();
        if (!trace.updated_at) trace.updated_at = trace.created_at;

        try {
            await sqliteService.request(['SET', `trace:payload:${id}`, JSON.stringify(trace)]);
            await sqliteService.request(['SADD', TRACE_INDEX_KEY, id]);

            if (trace.sessionId) {
                await sqliteService.request(['LPUSH', sessionTracesKey(trace.sessionId), id]);
            }

            const createdMs = new Date(trace.created_at).getTime();
            const bucketKey = getDayBucketKey('traces', createdMs);
            await sqliteService.request(['ZADD', bucketKey, createdMs, id]);

            eventBusService.emitKernelEvent(KernelEventType.TRACE_LOGGED, trace);
        } catch (error) {
            loggerService.error('TraceService: Failed to add trace', { error });
        }
    },

    async getTrace(id: string): Promise<TraceData | null> {
        const payload = await sqliteService.request(['GET', `trace:payload:${id}`]);
        return payload ? JSON.parse(payload) : null;
    },

    async listSessionTraces(sessionId: string): Promise<TraceData[]> {
        const ids = await sqliteService.request(['SMEMBERS', sessionTracesKey(sessionId)]);
        if (!ids) return [];
        const traces = await Promise.all(ids.map(id => this.getTrace(id)));
        return traces.filter((t): t is TraceData => t !== null);
    }
};
