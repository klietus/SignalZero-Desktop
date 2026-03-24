import { settingsService, McpConfiguration } from './settingsService.js';
import { loggerService } from './loggerService.js';
import { ChatCompletionTool } from 'openai/resources/chat/completions';

export interface McpTool extends ChatCompletionTool {
    mcpId: string;
}

export interface McpPrompt {
    name: string;
    description?: string;
    content: string;
    mcpId: string;
}

class McpClientService {
    private toolCache: Map<string, McpTool[]> = new Map();
    private promptCache: Map<string, McpPrompt[]> = new Map();

    async getEnabledConfigs(): Promise<McpConfiguration[]> {
        const configs = await settingsService.getMcpConfigs();
        return configs.filter(c => c.enabled && c.endpoint);
    }

    async refreshAll(): Promise<void> {
        const configs = await this.getEnabledConfigs();
        for (const config of configs) {
            await this.refreshConfig(config);
        }
    }

    private async refreshConfig(config: McpConfiguration): Promise<void> {
        try {
            const tools = await this.fetchTools(config);
            this.toolCache.set(config.id, tools);
            const prompts = await this.fetchPrompts(config);
            this.promptCache.set(config.id, prompts);
        } catch (error) {
            loggerService.error(`Failed to refresh MCP client: ${config.name}`, { error });
        }
    }

    private async fetchTools(config: McpConfiguration): Promise<McpTool[]> {
        try {
            const response = await fetch(config.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(config.token ? { 'Authorization': `Bearer ${config.token}` } : {})
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: Date.now(),
                    method: 'tools/list',
                    params: {}
                })
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (data.error) throw new Error(data.error.message || 'Unknown JSON-RPC error');

            const tools = data.result?.tools || [];
            return tools.map((t: any) => ({
                type: 'function',
                mcpId: config.id,
                function: {
                    name: `mcp_${config.id}_${t.name}`,
                    description: `[MCP: ${config.name}] ${t.description || ''}`,
                    parameters: t.inputSchema || { type: 'object', properties: {} }
                }
            }));
        } catch (error) {
            return [];
        }
    }

    private async fetchPrompts(config: McpConfiguration): Promise<McpPrompt[]> {
        try {
            const response = await fetch(config.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(config.token ? { 'Authorization': `Bearer ${config.token}` } : {})
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: Date.now(),
                    method: 'prompts/list',
                    params: {}
                })
            });

            if (!response.ok) return [];
            const data = await response.json();
            const prompts = data.result?.prompts || [];
            const resolvedPrompts: McpPrompt[] = [];

            for (const p of prompts) {
                try {
                    const getRes = await fetch(config.endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...(config.token ? { 'Authorization': `Bearer ${config.token}` } : {})
                        },
                        body: JSON.stringify({
                            jsonrpc: '2.0',
                            id: Date.now(),
                            method: 'prompts/get',
                            params: { name: p.name }
                        })
                    });
                    if (getRes.ok) {
                        const getData = await getRes.json();
                        const content = getData.result?.messages?.map((m: any) => m.content?.text).filter(Boolean).join('\n');
                        if (content) {
                            resolvedPrompts.push({ name: p.name, description: p.description, content, mcpId: config.id });
                        }
                    }
                } catch (e) {}
            }
            return resolvedPrompts;
        } catch (error) {
            return [];
        }
    }

    async getAllTools(): Promise<McpTool[]> {
        await this.refreshAll();
        return Array.from(this.toolCache.values()).flat();
    }

    async getAllPrompts(): Promise<McpPrompt[]> {
        return Array.from(this.promptCache.values()).flat();
    }

    async executeTool(mcpId: string, originalToolName: string, args: any): Promise<any> {
        const configs = await settingsService.getMcpConfigs();
        const config = configs.find(c => c.id === mcpId);
        if (!config) throw new Error(`MCP config ${mcpId} not found`);

        const response = await fetch(config.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(config.token ? { 'Authorization': `Bearer ${config.token}` } : {})
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'tools/call',
                params: {
                    name: originalToolName,
                    arguments: args
                }
            })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data.error) throw new Error(data.error.message || 'Unknown JSON-RPC error');
        return data.result;
    }
}

export const mcpClientService = new McpClientService();
