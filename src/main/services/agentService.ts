import { randomUUID } from 'crypto';
import { sqliteService } from './sqliteService.js';
import { loggerService } from './loggerService.js';
import { AgentDefinition, AgentExecutionLog } from '../types.js';

const AGENT_INDEX_KEY = 'agent:index';
const agentKey = (id: string) => `agent:payload:${id}`;
const agentLogsKey = (id: string) => `agent:logs:${id}`;

export const agentService = {
    async listAgents(): Promise<AgentDefinition[]> {
        const ids = await sqliteService.request(['SMEMBERS', AGENT_INDEX_KEY]);
        if (!ids) return [];
        const agents = await Promise.all(ids.map(id => this.getAgent(id)));
        return agents.filter((a): a is AgentDefinition => a !== null);
    },

    async getAgent(id: string): Promise<AgentDefinition | null> {
        const payload = await sqliteService.request(['GET', agentKey(id)]);
        return payload ? JSON.parse(payload) : null;
    },

    async upsertAgent(id: string, prompt: string, enabled: boolean, schedule?: string): Promise<AgentDefinition> {
        const existing = await this.getAgent(id);
        const agent: AgentDefinition = {
            id,
            prompt,
            enabled,
            schedule,
            createdAt: existing?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        await sqliteService.request(['SET', agentKey(id), JSON.stringify(agent)]);
        await sqliteService.request(['SADD', AGENT_INDEX_KEY, id]);
        return agent;
    },

    async deleteAgent(id: string): Promise<boolean> {
        await sqliteService.request(['DEL', agentKey(id)]);
        await sqliteService.request(['SREM', AGENT_INDEX_KEY, id]);
        await sqliteService.request(['DEL', agentLogsKey(id)]);
        return true;
    },

    async getExecutionLogs(agentId?: string, limit: number = 20, includeTraces: boolean = false): Promise<AgentExecutionLog[]> {
        // Simple implementation for desktop
        return [];
    }
};
