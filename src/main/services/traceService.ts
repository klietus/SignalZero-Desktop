import { sqliteService } from './sqliteService.js';
import { loggerService, LogCategory } from './loggerService.js';
import { TraceData, KernelEventType } from '../types.js';
import { eventBusService } from './eventBusService.js';
import { symbolCacheService } from './symbolCacheService.js';

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

            if (trace.sessionId && trace.activation_path && trace.activation_path.length > 0) {
                const symbolIds: string[] = [];
                for (const step of trace.activation_path) {
                    const sId = step.symbol_id || (step as any).id;
                    if (sId) {
                        symbolIds.push(sId);
                        await symbolCacheService.touchSymbol(trace.sessionId, sId);
                    }
                }

                for (let i = 0; i < symbolIds.length - 1; i++) {
                    const sourceId = symbolIds[i];
                    const targetId = symbolIds[i + 1];
                    if (sourceId && targetId) {
                        this.recordHebbianLink(sourceId, targetId, trace.id);
                    }
                }
            }

            eventBusService.emitKernelEvent(KernelEventType.TRACE_LOGGED, { trace } as const);
            if (loggerService) {
                loggerService.catDebug(LogCategory.SYSTEM, "Trace logged", { traceId: id, sessionId: trace.sessionId });
            }
        } catch (error: any) {
            if (loggerService) {
                loggerService.catError(LogCategory.SYSTEM, 'TraceService: Failed to add trace', { error: error.message, traceId: id });
            } else {
                console.error(`[TraceService] Failed to add trace ${id}: ${error.message}`);
            }
        }
    },

    recordHebbianLink(sourceId: string, targetId: string, traceId: string): void {
        try {
            const link = sqliteService.get(
                `SELECT * FROM symbol_links_v2 WHERE source_id = ? AND target_id = ?`,
                [sourceId, targetId]
            ) as any;

            if (!link) {
                sqliteService.run(`
                    INSERT INTO symbol_links_v2 (source_id, target_id, link_type, committed, access_count, access_ema, last_accessed, created_at)
                    VALUES (?, ?, 'coactivation', 'volatile', 1, 0.5, ?, ?)
                `, [sourceId, targetId, new Date().toISOString(), new Date().toISOString()]);
                
                if (loggerService) {
                    loggerService.catDebug(LogCategory.TOPOLOGY, `Hebbian link created: ${sourceId} -> ${targetId}`, { traceId });
                }
            } else {
                const newCount = (link.access_count || 0) + 1;
                const hoursSinceLastAccess = link.last_accessed 
                    ? (Date.now() - new Date(link.last_accessed).getTime()) / (1000 * 60 * 60)
                    : 1;
                const decayFactor = Math.pow(0.9, Math.min(hoursSinceLastAccess, 1));
                const newEma = Math.min(1, (link.access_ema || 0) * decayFactor + 0.5 * (1 - decayFactor));

                sqliteService.run(`
                    UPDATE symbol_links_v2 SET access_count = ?, access_ema = ?, last_accessed = ?
                    WHERE source_id = ? AND target_id = ?
                `, [newCount, newEma, new Date().toISOString(), sourceId, targetId]);

                if (loggerService) {
                    loggerService.catDebug(LogCategory.TOPOLOGY, `Hebbian link reinforced: ${sourceId} -> ${targetId}`, { 
                        traceId, 
                        count: newCount, 
                        ema: newEma.toFixed(3) 
                    });
                }
            }
        } catch (error: any) {
            if (loggerService) {
                loggerService.catWarn(LogCategory.TOPOLOGY, `Failed to record Hebbian link`, { sourceId, targetId, error: error.message });
            }
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
