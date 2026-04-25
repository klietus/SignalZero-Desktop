import { domainService } from './domainService.js';
import { testService } from './testService.js';
import { agentService } from './agentService.js';
import { ProjectMeta, ProjectImportStats, SymbolDef } from '../types.js';
import { eventBusService } from './eventBusService.js';
import { KernelEventType } from '../types.js';
import { lancedbService } from './lancedbService.js';
import { loggerService, LogCategory } from './loggerService.js';
import { systemPromptService } from './systemPromptService.js';
import { mcpPromptService } from './mcpPromptService.js';
import JSZip from 'jszip';

const yieldToEventLoop = () => new Promise(resolve => setTimeout(resolve, 0));

export const projectService = {
    async getActiveProjectMeta(): Promise<ProjectMeta> {
        return { name: 'SignalZero Desktop', version: '1.2.0', created_at: '', updated_at: '', author: 'klietus' };
    },

    async export(meta: ProjectMeta, systemPrompt: string, mcpPrompt: string): Promise<Uint8Array> {
        const zip = new JSZip();
        
        // 1. Metadata and Prompts
        zip.file('metadata.json', JSON.stringify(meta, null, 2));
        zip.file('system_prompt.txt', systemPrompt);
        zip.file('mcp_prompt.txt', mcpPrompt);

        // 3. Symbolic Store (Global Domains Only)
        const allDomains = await domainService.listDomains();
        const globalDomains = allDomains.filter(d => d !== 'user' && d !== 'state');
        
        const domainsFolder = zip.folder('domains');
        for (const d of globalDomains) {
            const domainMeta = await domainService.getDomain(d);
            const symbols = await domainService.getSymbols(d);
            if (domainsFolder) {
                domainsFolder.file(`${d}.json`, JSON.stringify({ meta: domainMeta, symbols }, null, 2));
            }
        }

        // 4. Test Suites
        const testSets = await testService.listTestSets();
        if (testSets.length > 0) {
            zip.file('tests.json', JSON.stringify(testSets, null, 2));
        }

        // 5. Autonomous Agents
        const agents = await agentService.listAgents();
        if (agents.length > 0) {
            zip.file('agents.json', JSON.stringify(agents, null, 2));
        }

        return await zip.generateAsync({ type: 'uint8array' });
    },

    async import(buffer: Buffer): Promise<{ stats: ProjectImportStats, systemPrompt?: string, mcpPrompt?: string }> {
        try {
            loggerService.catInfo(LogCategory.SYSTEM, "Project import started.");
            const zip = await JSZip.loadAsync(buffer);
            
            const emitStatus = (status: string, progress: number) => {
                loggerService.catInfo(LogCategory.SYSTEM, `Import Progress [${progress}%]: ${status}`);
                eventBusService.emitKernelEvent(KernelEventType.PROJECT_IMPORT_STATUS, { status, progress } as const);
            };

            emitStatus("Parsing project metadata...", 5);
            await yieldToEventLoop();

            // --- NESTED FOLDER DETECTION ---
            // Some zip tools wrap the export in a folder. We detect this by finding if all meaningful paths share a common root.
            const allPaths = Object.keys(zip.files).filter(p => !p.includes('__MACOSX') && !p.includes('.DS_Store'));
            let prefix = "";
            const firstPath = allPaths.find(p => p.includes('/'));
            if (firstPath) {
                const potentialPrefix = firstPath.split('/')[0] + '/';
                if (allPaths.every(p => p.startsWith(potentialPrefix))) {
                    prefix = potentialPrefix;
                    loggerService.catInfo(LogCategory.SYSTEM, `Detected nested archive. Using prefix: ${prefix}`);
                }
            }

            const getZipFile = (name: string) => zip.file(prefix + name);

            let meta: ProjectMeta = { name: 'Imported', version: '1.2.0', created_at: '', updated_at: '', author: '' };
            const metaFile = getZipFile('metadata.json');
            if (metaFile) {
                const text = await metaFile.async('string');
                if (text) {
                    try {
                        meta = JSON.parse(text);
                        loggerService.catInfo(LogCategory.SYSTEM, `Project name: ${meta.name}, Author: ${meta.author}`);
                    } catch (e) {
                        loggerService.catWarn(LogCategory.SYSTEM, "Failed to parse metadata.json");
                    }
                }
            }

            let systemPrompt: string | undefined;
            const spFile = getZipFile('system_prompt.txt');
            if (spFile) {
                systemPrompt = await spFile.async('string');
                if (systemPrompt) {
                    await systemPromptService.setPrompt(systemPrompt);
                    loggerService.catInfo(LogCategory.SYSTEM, "System prompt restored.");
                }
            }

            let mcpPrompt: string | undefined;
            const mcpFile = getZipFile('mcp_prompt.txt');
            if (mcpFile) {
                mcpPrompt = await mcpFile.async('string');
                if (mcpPrompt) {
                    await mcpPromptService.setPrompt(mcpPrompt);
                    loggerService.catInfo(LogCategory.SYSTEM, "MCP prompt restored.");
                }
            }

            emitStatus("Clearing existing symbolic graph...", 10);
            await domainService.clearAll();
            await yieldToEventLoop();

            const domains: Array<{ id: string; name: string; symbolCount: number }> = [];
            
            // --- DOMAIN DISCOVERY ---
            const domainsPath = prefix + 'domains/';
            const domainFiles = Object.keys(zip.files).filter(path => 
                path.startsWith(domainsPath) && 
                path.endsWith('.json') && 
                !zip.files[path].dir &&
                !path.includes('__MACOSX') &&
                !path.includes('.DS_Store')
            );
            
            const allSymbolsToUpsert: SymbolDef[] = [];

            emitStatus(`Preparing to import ${domainFiles.length} domains...`, 15);
            loggerService.catInfo(LogCategory.SYSTEM, `Found ${domainFiles.length} domain files.`);
            
            for (let i = 0; i < domainFiles.length; i++) {
                const filePath = domainFiles[i];
                const file = zip.file(filePath);
                if (!file) continue;

                try {
                    const text = await file.async('string');
                    const data = JSON.parse(text);
                    
                    // Support both current format { meta, symbols } and legacy { domain, items }
                    let dMeta = data.meta;
                    let symbols = data.symbols;

                    if (!dMeta && data.domain) {
                        dMeta = {
                            id: data.domain,
                            name: data.name || data.domain,
                            description: data.description,
                            invariants: data.invariants,
                            enabled: data.enabled !== false,
                            read_only: data.readOnly === true
                        };
                    }

                    if (!symbols && Array.isArray(data.items)) {
                        symbols = data.items;
                    }
                    
                    if (!dMeta || !dMeta.id) {
                        loggerService.catWarn(LogCategory.SYSTEM, `Domain file ${filePath} is missing valid metadata. Skipping.`);
                        continue;
                    }

                    // Skip user/state domains to prevent overriding local session identity
                    if (dMeta.id === 'user' || dMeta.id === 'state') {
                        continue;
                    }

                    await domainService.createDomain(dMeta.id, dMeta);
                    if (Array.isArray(symbols)) {
                        allSymbolsToUpsert.push(...symbols);
                        domains.push({ id: dMeta.id, name: dMeta.name || dMeta.id, symbolCount: symbols.length });
                    }
                    
                    const domainProgress = 15 + Math.floor(((i + 1) / domainFiles.length) * 15);
                    if (i % 5 === 0 || i === domainFiles.length - 1) {
                        emitStatus(`Parsing domain: ${dMeta.id}`, domainProgress);
                    }
                } catch (e: any) {
                    loggerService.catError(LogCategory.SYSTEM, `Failed to parse domain: ${filePath}`, { error: e.message || e });
                }
                
                if (i % 10 === 0) await yieldToEventLoop();
            }

            emitStatus(`Establishing relational integrity for ${allSymbolsToUpsert.length} symbols...`, 30);
            await yieldToEventLoop();
            await domainService.bulkUpsert('', allSymbolsToUpsert, true); // skipIndexing=true

            emitStatus(`Vectorizing ${allSymbolsToUpsert.length} symbols...`, 40);
            await lancedbService.indexBatch(allSymbolsToUpsert, async (indexed, total) => {
                const vectorProgress = 40 + Math.floor((indexed / total) * 40);
                if (indexed % 100 === 0 || indexed === total) {
                    emitStatus(`Vectorizing: ${indexed}/${total}`, vectorProgress);
                }
                await yieldToEventLoop();
            });

            // --- TEST SUITES ---
            emitStatus("Restoring test suites...", 85);
            await yieldToEventLoop();
            let testCaseCount = 0;
            const testsFile = getZipFile('tests.json');
            if (testsFile) {
                const text = await testsFile.async('string');
                if (text) {
                    try {
                        const sets = JSON.parse(text);
                        await testService.replaceAllTestSets(sets);
                        testCaseCount = sets.reduce((sum: number, s: any) => sum + (s.tests?.length || 0), 0);
                        loggerService.catInfo(LogCategory.SYSTEM, `Restored ${sets.length} test sets.`);
                    } catch (e) {
                        loggerService.catError(LogCategory.SYSTEM, "Failed to restore test suites", { error: e });
                    }
                }
            }

            // --- AUTONOMOUS AGENTS ---
            emitStatus("Restoring autonomous agents...", 95);
            await yieldToEventLoop();
            let agentCount = 0;
            const agentsFile = getZipFile('agents.json') || getZipFile('loops.json');
            if (agentsFile) {
                const text = await agentsFile.async('string');
                if (text) {
                    try {
                        const agents = JSON.parse(text);
                        if (Array.isArray(agents)) {
                            for (const agent of agents) {
                                await agentService.upsertAgent(
                                    agent.id, 
                                    agent.prompt, 
                                    agent.enabled, 
                                    agent.schedule,
                                    agent.subscriptions
                                );
                            }
                            agentCount = agents.length;
                            loggerService.catInfo(LogCategory.SYSTEM, `Restored ${agentCount} agents.`);
                        }
                    } catch (e) {
                        loggerService.catError(LogCategory.SYSTEM, "Failed to restore agents", { error: e });
                    }
                }
            }

            emitStatus("Import complete.", 100);
            loggerService.catInfo(LogCategory.SYSTEM, "Project import finished successfully.");
            
            const stats: ProjectImportStats = {
                meta,
                testCaseCount,
                agentCount,
                domains,
                totalSymbols: allSymbolsToUpsert.length
            };

            eventBusService.emitKernelEvent(KernelEventType.PROJECT_IMPORT_STATUS, { 
                status: "COMPLETE", 
                progress: 100,
                stats
            } as const);

            return { stats, systemPrompt, mcpPrompt };
        } catch (error: any) {
            loggerService.catError(LogCategory.SYSTEM, "Project import failed", { error: error.message });
            eventBusService.emitKernelEvent(KernelEventType.PROJECT_IMPORT_STATUS, { 
                status: "FAILED", 
                progress: 0,
                error: error.message 
            } as const);
            throw error;
        }
    }
};
