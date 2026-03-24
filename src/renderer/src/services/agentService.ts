import { apiFetch } from './api';
import { AgentDefinition, AgentExecutionWithTraces } from '../types';

interface AgentPayload {
    schedule?: string;
    prompt: string;
    enabled: boolean;
}

interface LogQuery {
    agentId?: string;
    limit?: number;
    includeTraces?: boolean;
}

export const agentService = {
    async list(): Promise<AgentDefinition[]> {
        const res = await apiFetch('/agents');
        if (!res.ok) throw new Error('Failed to fetch agents');
        const data = await res.json();
        return data.agents || [];
    },

    async get(id: string): Promise<AgentDefinition | null> {
        const res = await apiFetch(`/agents/${encodeURIComponent(id)}`);
        if (res.status === 404) return null;
        if (!res.ok) throw new Error('Failed to fetch agent');
        return await res.json();
    },

    async upsert(id: string, payload: AgentPayload): Promise<AgentDefinition> {
        const res = await apiFetch(`/agents/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Failed to save agent');
        return await res.json();
    },

    async delete(id: string): Promise<void> {
        const res = await apiFetch(`/agents/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error('Failed to delete agent');
    },

    async trigger(id: string): Promise<void> {
        const res = await apiFetch(`/agents/${encodeURIComponent(id)}/trigger`, {
            method: 'POST'
        });
        if (!res.ok) throw new Error('Failed to trigger agent');
    },

    async listLogs(params: LogQuery = {}): Promise<AgentExecutionWithTraces[]> {
        const query = new URLSearchParams();
        if (params.agentId) query.set('agentId', params.agentId);
        if (params.limit) query.set('limit', String(params.limit));
        if (params.includeTraces) query.set('includeTraces', 'true');

        const path = `/agents/logs${query.toString() ? `?${query.toString()}` : ''}`;
        const res = await apiFetch(path);
        if (!res.ok) throw new Error('Failed to fetch agent logs');
        const data = await res.json();
        return data.logs || [];
    }
};
