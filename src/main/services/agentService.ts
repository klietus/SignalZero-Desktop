import { sqliteService } from './sqliteService.js';
import { loggerService, LogCategory } from './loggerService.js';
import { AgentDefinition, AgentExecutionLog } from '../types.js';
import { randomUUID } from 'crypto';

export const agentService = {
    async listAgents(): Promise<AgentDefinition[]> {
        const rows = sqliteService.all(`SELECT * FROM agents ORDER BY id ASC`);
        return rows.map(r => ({
            ...r,
            enabled: !!r.enabled,
            subscriptions: r.subscriptions ? JSON.parse(r.subscriptions) : []
        }));
    },

    async getAgent(id: string): Promise<AgentDefinition | null> {
        const row = sqliteService.get(`SELECT * FROM agents WHERE id = ?`, [id]);
        if (!row) return null;
        return {
            ...row,
            enabled: !!row.enabled,
            subscriptions: row.subscriptions ? JSON.parse(row.subscriptions) : []
        };
    },

    async upsertAgent(id: string, prompt: string, enabled: boolean, schedule?: string, subscriptions?: string[]): Promise<void> {
        const now = new Date().toISOString();
        sqliteService.run(
            `INSERT OR REPLACE INTO agents (id, prompt, enabled, schedule, subscriptions, created_at, updated_at) 
             VALUES (?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM agents WHERE id = ?), ?), ?)`,
            [id, prompt, enabled ? 1 : 0, schedule || null, subscriptions ? JSON.stringify(subscriptions) : null, id, now, now]
        );
        loggerService.catInfo(LogCategory.AGENT, "Agent upserted", { id, enabled, subscriptions });
    },

    async deleteAgent(id: string): Promise<void> {
        sqliteService.run(`DELETE FROM agents WHERE id = ?`, [id]);
        loggerService.catInfo(LogCategory.AGENT, "Agent deleted", { id });
    },

    async logExecution(log: Omit<AgentExecutionLog, 'id'>): Promise<string> {
        const id = randomUUID();
        sqliteService.run(
            `INSERT INTO agent_execution_logs (id, agent_id, started_at, finished_at, status, trace_count, log_file_path, response_preview, error)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                log.agentId,
                log.startedAt,
                log.finishedAt || null,
                log.status,
                log.traceCount,
                log.logFilePath || null,
                log.responsePreview || null,
                log.error || null
            ]
        );
        return id;
    },

    async getExecutionLogs(agentId: string, limit: number = 50): Promise<AgentExecutionLog[]> {
        const rows = sqliteService.all(
            `SELECT * FROM agent_execution_logs WHERE agent_id = ? ORDER BY started_at DESC LIMIT ?`,
            [agentId, limit]
        );
        return rows as AgentExecutionLog[];
    },

    async isDeltaProcessed(agentId: string, deltaId: string): Promise<boolean> {
        const row = sqliteService.get(
            `SELECT 1 FROM agent_processed_deltas WHERE agent_id = ? AND delta_id = ?`,
            [agentId, deltaId]
        );
        return !!row;
    },

    async markDeltaProcessed(agentId: string, deltaId: string): Promise<void> {
        sqliteService.run(
            `INSERT OR IGNORE INTO agent_processed_deltas (agent_id, delta_id) VALUES (?, ?)`,
            [agentId, deltaId]
        );
    },

    async getUnprocessedDeltas(agentId: string, limit: number = 10): Promise<any[]> {
        return sqliteService.all(`
            SELECT d.* FROM monitoring_deltas d
            WHERE d.id NOT IN (
                SELECT delta_id FROM agent_processed_deltas WHERE agent_id = ?
            )
            ORDER BY d.timestamp DESC
            LIMIT ?
        `, [agentId, limit]);
    }
};
