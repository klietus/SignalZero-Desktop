import { describe, it, expect, vi, beforeEach } from 'vitest';
import { projectService } from '../services/projectService.js';
import { domainService } from '../services/domainService.js';
import { lancedbService } from '../services/lancedbService.js';
import { agentService } from '../services/agentService.js';
import { testService } from '../services/testService.js';
import { systemPromptService } from '../services/systemPromptService.js';
import { mcpPromptService } from '../services/mcpPromptService.js';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

// Mock all downstream services to isolate projectService.import
vi.mock('../services/domainService.js', () => ({
    domainService: {
        clearAll: vi.fn().mockResolvedValue(undefined),
        createDomain: vi.fn().mockResolvedValue(undefined),
        bulkUpsert: vi.fn().mockResolvedValue(undefined),
        listDomains: vi.fn().mockResolvedValue([])
    }
}));

vi.mock('../services/lancedbService.js', () => ({
    lancedbService: {
        indexBatch: vi.fn().mockImplementation((symbols, cb) => {
            if (cb) cb(symbols.length, symbols.length);
            return Promise.resolve();
        })
    }
}));

vi.mock('../services/agentService.js', () => ({
    agentService: {
        upsertAgent: vi.fn().mockResolvedValue(undefined),
        listAgents: vi.fn().mockResolvedValue([])
    }
}));

vi.mock('../services/testService.js', () => ({
    testService: {
        replaceAllTestSets: vi.fn().mockResolvedValue(undefined),
        listTestSets: vi.fn().mockResolvedValue([])
    }
}));

vi.mock('../services/systemPromptService.js', () => ({
    systemPromptService: {
        setPrompt: vi.fn().mockResolvedValue(undefined)
    }
}));

vi.mock('../services/mcpPromptService.js', () => ({
    mcpPromptService: {
        setPrompt: vi.fn().mockResolvedValue(undefined)
    }
}));

// Mock logger to keep output clean
vi.mock('../services/loggerService.js', () => ({
    loggerService: {
        catInfo: vi.fn(),
        catWarn: vi.fn(),
        catError: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    },
    LogCategory: {
        SYSTEM: 'SYSTEM'
    }
}));

describe('Sample Project Build & Parse Test', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should build and then successfully parse the sample project', async () => {
        // 1. Build the sample project using the shell script
        // This ensures the test is running against the latest decomposed files
        const projectRoot = join(__dirname, '../../..');
        const buildScript = join(projectRoot, 'scripts/build-sample-project.sh');
        const projectFile = join(projectRoot, 'signalzero_sample.szproject');

        try {
            execSync(`bash "${buildScript}"`, { cwd: projectRoot, stdio: 'ignore' });
        } catch (err) {
            throw new Error(`Failed to build sample project: ${err}`);
        }

        // 2. Load the project file into a buffer
        const buffer = readFileSync(projectFile);

        // 3. Import the project using projectService
        const result = await projectService.import(buffer);

        // 4. Validate Stats
        expect(result.stats).toBeDefined();
        expect(result.stats.meta.name).toBe('SignalZero Desktop');
        expect(result.stats.agentCount).toBeGreaterThan(0);
        expect(result.stats.totalSymbols).toBeGreaterThan(700); // Sample project has around 769 symbols
        
        // 5. Validate Domain Discovery
        // Verify some known domains are present
        const domainIds = result.stats.domains.map(d => d.id);
        expect(domainIds).toContain('root');
        expect(domainIds).toContain('cyber_sec');
        expect(domainIds).toContain('self');
        
        // Ensure user and state domains are SKIPPED during import (as per projectService.ts logic)
        expect(domainIds).not.toContain('user');
        expect(domainIds).not.toContain('state');

        // 6. Verify Service Calls
        expect(domainService.clearAll).toHaveBeenCalled();
        expect(domainService.createDomain).toHaveBeenCalled();
        expect(domainService.bulkUpsert).toHaveBeenCalled();
        expect(lancedbService.indexBatch).toHaveBeenCalled();
        expect(agentService.upsertAgent).toHaveBeenCalled();
        expect(systemPromptService.setPrompt).toHaveBeenCalled();
        
        // system_prompt.txt should have content
        expect(result.systemPrompt).toBeDefined();
        expect(result.systemPrompt?.length).toBeGreaterThan(1000);
    });
});
