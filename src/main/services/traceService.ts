import { sqliteService } from './sqliteService.js';
import { loggerService, LogCategory } from './loggerService.js';
import { TraceData } from '../types.js';
import { eventBusService, KernelEventType } from './eventBusService.js';

export const traceService = {
    async addTrace(trace: TraceData): Promise<void> {
        const id = trace.id || `tr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        trace.id = id;
        const now = new Date().toISOString();
        if (!trace.created_at) trace.created_at = now;
        if (!trace.updated_at) trace.updated_at = now;

        try {
            sqliteService.run(
                `INSERT OR REPLACE INTO traces (id, context_id, entry_node, output_node, activation_path, source_context, status, created_at, updated_at) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    id,
                    trace.sessionId || null,
                    trace.entry_node || null,
                    trace.output_node || null,
                    JSON.stringify(trace.activation_path || []),
                    JSON.stringify(trace.source_context || {}),
                    trace.status || 'completed',
                    trace.created_at,
                    trace.updated_at
                ]
            );

            eventBusService.emitKernelEvent(KernelEventType.TRACE_LOGGED, trace);
            loggerService.catDebug(LogCategory.SYSTEM, "Trace logged", { traceId: id, sessionId: trace.sessionId });
        } catch (error: any) {
            loggerService.catError(LogCategory.SYSTEM, 'TraceService: Failed to add trace', { error: error.message, traceId: id });
        }
    },

    async getTrace(id: string): Promise<TraceData | null> {
        const row = sqliteService.get(`SELECT * FROM traces WHERE id = ?`, [id]);
        if (!row) return null;
        return {
            ...row,
            sessionId: row.context_id,
            activation_path: row.activation_path ? JSON.parse(row.activation_path) : [],
            source_context: row.source_context ? JSON.parse(row.source_context) : {}
        };
    },

    async listSessionTraces(sessionId: string): Promise<TraceData[]> {
        const rows = sqliteService.all(`SELECT * FROM traces WHERE context_id = ? ORDER BY created_at ASC`, [sessionId]);
        return rows.map(row => ({
            ...row,
            sessionId: row.context_id,
            activation_path: row.activation_path ? JSON.parse(row.activation_path) : [],
            source_context: row.source_context ? JSON.parse(row.source_context) : {}
        }));
    },

    async getBySession(sessionId: string): Promise<TraceData[]> {
        return this.listSessionTraces(sessionId);
    }
};
