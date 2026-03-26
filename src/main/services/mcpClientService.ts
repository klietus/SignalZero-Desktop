import { settingsService } from './settingsService.js';
import { loggerService, LogCategory } from './loggerService.js';
import { ChatCompletionTool } from 'openai/resources/chat/completions';
import { McpConfiguration } from '../types.js';

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
        const settings = await settingsService.get();
        return (settings.mcpConfigs || []).filter(c => c.enabled && c.endpoint);
    }

    async refreshAll(): Promise<void> {
        const configs = await this.getEnabledConfigs();
        for (const config of configs) {
            await this.refreshConfig(config);
        }
    }

    async validateConfig(endpoint: string, token?: string): Promise<{ success: boolean, toolCount: number, error?: string }> {
        try {
            const mockConfig: McpConfiguration = {
                id: 'temp-val',
                name: 'Validation',
                endpoint,
                token,
                enabled: true
            };
            const tools = await this.fetchTools(mockConfig);
            if (tools.length === 0) {
                // If it succeeded but returned 0 tools, might still be valid or might be an error
                // Most servers have at least one tool or we check if the fetch didn't throw.
            }
            return { success: true, toolCount: tools.length };
        } catch (error: any) {
            return { success: false, toolCount: 0, error: error.message };
        }
    }

    private async refreshConfig(config: McpConfiguration): Promise<void> {
        try {
            loggerService.catInfo(LogCategory.SYSTEM, `Refreshing MCP client: ${config.name}`, { endpoint: config.endpoint });
            
            // 1. Fetch Tools
            const tools = await this.fetchTools(config);
            this.toolCache.set(config.id, tools);

            // 2. Fetch Prompts
            const prompts = await this.fetchPrompts(config);
            this.promptCache.set(config.id, prompts);

            loggerService.catInfo(LogCategory.SYSTEM, `MCP client ${config.name} refreshed`, { 
                toolCount: tools.length, 
                promptCount: prompts.length 
            });
        } catch (error) {
            loggerService.catError(LogCategory.SYSTEM, `Failed to refresh MCP client: ${config.name}`, { error });
        }
    }

    private async fetchTools(config: McpConfiguration): Promise<McpTool[]> {
        try {
            const response = await fetch(config.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(config.token ? { 
                        'Authorization': `Bearer ${config.token}`, 
                        'X-API-Key': config.token,
                        'x-api-key': config.token 
                    } : {})
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: Date.now(),
                    method: 'tools/list',
                    params: {}
                })
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data: any = await response.json();
            
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
            loggerService.catWarn(LogCategory.SYSTEM, `Could not fetch tools from MCP ${config.name}`, { error });
            throw error; // Rethrow for validation
        }
    }

    private async fetchPrompts(config: McpConfiguration): Promise<McpPrompt[]> {
        try {
            const response = await fetch(config.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(config.token ? { 
                        'Authorization': `Bearer ${config.token}`, 
                        'X-API-Key': config.token,
                        'x-api-key': config.token 
                    } : {})
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: Date.now(),
                    method: 'prompts/list',
                    params: {}
                })
            });

            if (!response.ok) return [];
            const data: any = await response.json();
            if (data.error) return [];

            const prompts = data.result?.prompts || [];
            const resolvedPrompts: McpPrompt[] = [];

            for (const p of prompts) {
                try {
                    const getRes = await fetch(config.endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...(config.token ? { 'Authorization': `Bearer ${config.token}`, 'X-API-Key': config.token } : {})
                        },
                        body: JSON.stringify({
                            jsonrpc: '2.0',
                            id: Date.now(),
                            method: 'prompts/get',
                            params: { name: p.name }
                        })
                    });
                    if (getRes.ok) {
                        const getData: any = await getRes.json();
                        const content = getData.result?.messages?.map((m: any) => m.content?.text).filter(Boolean).join('\n');
                        if (content) {
                            resolvedPrompts.push({
                                name: p.name,
                                description: p.description,
                                content,
                                mcpId: config.id
                            });
                        }
                    }
                } catch (e) {
                    // Ignore individual prompt failures
                }
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
        const settings = await settingsService.get();
        const config = (settings.mcpConfigs || []).find(c => c.id === mcpId);
        if (!config) throw new Error(`MCP config ${mcpId} not found`);

        try {
            const response = await fetch(config.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(config.token ? { 
                        'Authorization': `Bearer ${config.token}`, 
                        'X-API-Key': config.token,
                        'x-api-key': config.token 
                    } : {})
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
            const data: any = await response.json();
            if (data.error) throw new Error(data.error.message || 'Unknown JSON-RPC error');

            return data.result;
        } catch (error) {
            loggerService.catError(LogCategory.SYSTEM, `MCP Tool Execution Failed: ${originalToolName}`, { error, mcpId });
            throw error;
        }
    }
}

export const mcpClientService = new McpClientService();
