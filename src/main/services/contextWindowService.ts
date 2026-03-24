
import { contextService } from './contextService.js';
import { domainService } from './domainService.js';
import { symbolCacheService } from './symbolCacheService.js';
import { SymbolDef, ContextMessage, ContextKind } from '../types.js';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { loggerService } from './loggerService.js';
import { buildSystemMetadataBlock } from './timeService.js';
import { getEncoding } from "js-tiktoken";

const enc = getEncoding("cl100k_base");

export class ContextWindowService {
    private readonly TOKEN_LIMIT = 100000;

    async constructContextWindow(
        contextSessionId: string,
        systemPrompt: string
    ): Promise<ChatCompletionMessageParam[]> {
        const messages: ChatCompletionMessageParam[] = [];

        const session = await contextService.getSession(contextSessionId);
        const type = session?.type || 'conversation';

        let effectiveSystemPrompt = systemPrompt;
        if (type === 'agent' && session?.metadata?.agentPrompt) {
            effectiveSystemPrompt = `${systemPrompt}\n\n[Agent Prompt]\n${session.metadata.agentPrompt}`;
        }
        messages.push({ role: 'system', content: effectiveSystemPrompt });

        const stableContext = await this.buildStableContext(contextSessionId);
        messages.push({
            role: 'system',
            content: `[KERNEL]\n${stableContext}`
        });

        const { mature, newSymbols } = await symbolCacheService.getPartitionedSymbols(contextSessionId);
        if (mature.length > 0) {
            messages.push({
                role: 'system',
                content: `[MATURE_SYMBOLS]\n${this.formatSymbols(mature)}`
            });
        }

        if (session?.summary) {
            messages.push({
                role: 'system',
                content: `[HISTORY_SUMMARY]\n${session.summary}`
            });
        }

        let currentTokens = messages.reduce((sum, m) => sum + this.estimateTokens(JSON.stringify(m)), 0);

        const rawHistory = await contextService.getUnfilteredHistory(contextSessionId);
        
        const lastSummarized = session?.metadata?.lastSummarizedRoundCount || 0;
        const userMessageIndices = rawHistory
            .map((m, i) => m.role === 'user' ? i : -1)
            .filter(i => i !== -1);
            
        const firstIncludedIndex = (lastSummarized > 0)
            ? (lastSummarized < userMessageIndices.length ? userMessageIndices[lastSummarized] : rawHistory.length)
            : 0;
            
        const effectiveHistory = rawHistory.slice(firstIncludedIndex);
        const historyMessages: ChatCompletionMessageParam[] = [];

        const rounds: ContextMessage[][] = [];
        let currentRound: ContextMessage[] = [];

        for (let i = effectiveHistory.length - 1; i >= 0; i--) {
            const msg = effectiveHistory[i];
            currentRound.unshift(msg);
            if (msg.role === 'user') {
                rounds.push(currentRound);
                currentRound = [];
            }
        }
        if (currentRound.length > 0) rounds.push(currentRound);

        const maxRounds = session?.summary ? 5 : 10;
        for (let index = 0; index < rounds.length; index++) {
            if (index >= maxRounds) break;

            let round = rounds[index];
            if (index > 0) round = this.stripTools(round);
            if (round.length === 0) continue;

            let roundMessages = round.map(msg => this.mapToOpenAIMessage(msg));
            let roundTokens = roundMessages.reduce((sum, msg) => sum + this.estimateTokens(JSON.stringify(msg)), 0);

            if (currentTokens + roundTokens > this.TOKEN_LIMIT) {
                if (index > 0) break;
            }

            historyMessages.unshift(...roundMessages);
            currentTokens += roundTokens;
        }

        if (historyMessages.length > 0) {
            messages.push({ role: 'user', content: `[CONVERSATION_HISTORY_START]` });
            messages.push(...historyMessages);
        }

        const dynamicContext = await this.buildDynamicContext(contextSessionId, type, newSymbols);
        if (dynamicContext.trim().length > 0) {
            messages.push({
                role: 'system',
                content: `[DYNAMIC_SYMBOLS]\n${dynamicContext}`
            });
        }

        const systemMetadata = buildSystemMetadataBlock({
            id: session?.id,
            type: session?.type,
            lifecycle: session?.status === 'closed' ? 'zombie' : 'live',
            readonly: session?.metadata?.readOnly === true,
            trace_needed: session?.metadata?.trace_needed,
            trace_reason: session?.metadata?.trace_reason
        });

        messages.push({
            role: 'system',
            content: `[SYSTEM_STATE]\n${JSON.stringify(systemMetadata, null, 2)}`
        });

        return messages;
    }

    public stripTools(round: ContextMessage[]): ContextMessage[] {
        return round.map(msg => {
            if (msg.role === 'tool') return null;
            if ((msg.role === 'assistant' || msg.role === 'model') && msg.toolCalls) {
                return { ...msg, toolCalls: undefined } as ContextMessage;
            }
            return msg;
        }).filter((msg): msg is ContextMessage => {
            if (!msg) return false;
            if ((msg.role === 'assistant' || msg.role === 'model')) {
                return !!(msg.content && msg.content.trim().length > 0);
            }
            return true;
        });
    }

    private mapToOpenAIMessage(msg: ContextMessage): ChatCompletionMessageParam {
        let role = msg.role;
        if (role === 'model') role = 'assistant';

        const chatMsg: any = {
            role: role,
            content: msg.content || null,
        };

        if (msg.toolCalls && msg.toolCalls.length > 0) {
            chatMsg.tool_calls = msg.toolCalls.map((tc: any) => ({
                id: tc.id,
                type: 'function',
                function: {
                    name: tc.name,
                    arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments)
                }
            }));
        }

        if (role === 'tool') {
            chatMsg.tool_call_id = msg.toolCallId;
        }

        return chatMsg as ChatCompletionMessageParam;
    }

    private estimateTokens(text: string): number {
        return enc.encode(text).length;
    }

    private formatSymbols(symbols: SymbolDef[]): string {
        if (symbols.length === 0) return "None found.";
        const uniqueMap = new Map<string, SymbolDef>();
        symbols.forEach(s => uniqueMap.set(s.id, s));
        const uniqueSymbols = Array.from(uniqueMap.values());
        uniqueSymbols.sort((a, b) => a.id.localeCompare(b.id));

        return uniqueSymbols.map(s => {
            const triadStr = Array.isArray(s.triad) ? s.triad.join(', ') : s.triad;
            return `| ${s.id} | ${s.name} | ${triadStr} | ${s.kind || 'pattern'} | ${(s.macro || "").slice(0, 100)} |`;
        }).join('\n');
    }

    private async buildStableContext(contextSessionId: string): Promise<string> {
        try {
            const results: string[] = [];
            const meta = await domainService.getMetadata();
            const domains = meta.map(d => `| ${d.id} | ${d.name} | ${d.invariants?.join('; ') || ''} |`);
            results.push(`[DOMAINS]\n${domains.join('\n')}`);

            const coreSet = new Map<string, SymbolDef>();
            await this.recursiveSymbolLoad('SELF-RECURSIVE-CORE', 3, coreSet);
            const coreSymbols = Array.from(coreSet.values());
            symbolCacheService.batchUpsertSymbols(contextSessionId, coreSymbols, 4);

            const rootSet = new Map<string, SymbolDef>();
            await this.recursiveSymbolLoad('ROOT-SYNTHETIC-CORE', 3, rootSet);
            const rootSymbols = Array.from(rootSet.values());
            symbolCacheService.batchUpsertSymbols(contextSessionId, rootSymbols, 4);

            return results.join('');
        } catch (error: any) {
            return "Error loading stable context.";
        }
    }

    private async recursiveSymbolLoad(startId: string, depth: number, collected: Map<string, SymbolDef>) {
        if (depth < 0 || collected.has(startId)) return;
        const symbol = await domainService.findById(startId);
        if (!symbol) return;
        collected.set(symbol.id, symbol);
        if (depth > 0 && symbol.linked_patterns) {
            await Promise.all(symbol.linked_patterns.map(link =>
                this.recursiveSymbolLoad(link.id, depth - 1, collected)
            ));
        }
    }

    private async buildDynamicContext(
        contextSessionId: string, 
        type: ContextKind = 'conversation', 
        newSymbols: SymbolDef[] = []
    ): Promise<string> {
        try {
            const results: string[] = [];
            if (type !== 'agent') {
                const userSet = new Map<string, SymbolDef>();
                await this.recursiveSymbolLoad('USER-RECURSIVE-CORE', 3, userSet);
                const userSymbols = Array.from(userSet.values());
                symbolCacheService.batchUpsertSymbols(contextSessionId, userSymbols, 4);
            }
            if (newSymbols.length > 0) {
                results.push(`\n[SYMBOL CACHE]\n${this.formatSymbols(newSymbols)}`);
            }
            await symbolCacheService.emitCacheLoad(contextSessionId);
            return results.join('');
        } catch (error: any) {
            return "Error loading dynamic context.";
        }
    }
}

export const contextWindowService = new ContextWindowService();
