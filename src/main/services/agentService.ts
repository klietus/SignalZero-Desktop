import { sqliteService } from './sqliteService.js';
import { loggerService, LogCategory } from './loggerService.js';
import { AgentDefinition, AgentExecutionLog } from '../types.js';
import { randomUUID } from 'crypto';

export const agentService = {
    async listAgents(): Promise<AgentDefinition[]> {
        const rows = sqliteService.all(`SELECT * FROM agents ORDER BY id ASC`);
        return rows.map(r => ({
            ...r,
            enabled: !!r.enabled
        }));
    },

    async getAgent(id: string): Promise<AgentDefinition | null> {
        const row = sqliteService.get(`SELECT * FROM agents WHERE id = ?`, [id]);
        if (!row) return null;
        return {
            ...row,
            enabled: !!row.enabled
        };
    },

    async upsertAgent(id: string, prompt: string, enabled: boolean, schedule?: string): Promise<void> {
        const now = new Date().toISOString();
        sqliteService.run(
            `INSERT OR REPLACE INTO agents (id, prompt, enabled, schedule, created_at, updated_at) 
             VALUES (?, ?, ?, ?, COALESCE((SELECT created_at FROM agents WHERE id = ?), ?), ?)`,
            [id, prompt, enabled ? 1 : 0, schedule || null, id, now, now]
        );
        loggerService.catInfo(LogCategory.AGENT, "Agent upserted", { id, enabled });
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
    }
};
