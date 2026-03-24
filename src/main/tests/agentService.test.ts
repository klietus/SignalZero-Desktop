import { describe, it, expect, beforeEach } from 'vitest';
import { agentService } from '../services/agentService.js';
import { sqliteService } from '../services/sqliteService.js';

describe('AgentService Relational', () => {
    beforeEach(() => {
        sqliteService.__sqliteTestUtils.reset();
    });

    it('should upsert and list agents from the agents table', async () => {
        await agentService.upsertAgent('agent-1', 'Prompt 1', true, '0 * * * *');
        await agentService.upsertAgent('agent-2', 'Prompt 2', false);

        const list = await agentService.listAgents();
        expect(list).toHaveLength(2);
        expect(list.find(a => a.id === 'agent-1')?.enabled).toBe(true);
        expect(list.find(a => a.id === 'agent-2')?.enabled).toBe(false);
    });

    it('should delete an agent', async () => {
        await agentService.upsertAgent('del-me', '...', true);
        await agentService.deleteAgent('del-me');
        const list = await agentService.listAgents();
        expect(list).toHaveLength(0);
    });
});
