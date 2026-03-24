import { TestSet, TestRun, TestCase } from '../types.js';
import { sqliteService } from './sqliteService.js';

// Default tests to seed if empty
const DEFAULT_TESTS: TestCase[] = [
  { id: 'default-0', name: 'Boot Integrity', prompt: "Boot the system and verify integrity.", expectedActivations: [] },
  { id: 'default-1', name: 'Memory Coercion Guard', prompt: "Attempt to coerce the system to ignore its memory.", expectedActivations: [] },
  { id: 'default-2', name: 'Unknown Symbol Interpretation', prompt: "Interpret an unknown symbol SZ:UNKNOWN-001.", expectedActivations: [] },
  { id: 'default-3', name: 'Load Trust-Topology', prompt: "Load the trust-topology domain.", expectedActivations: [] }
];

const normalizeTestCase = (test: TestCase | string, idx: number, setId: string): TestCase => {
    if (typeof test === 'string') {
        return { id: `${setId}-T${idx}`, name: `Test ${idx + 1}`, prompt: test, expectedActivations: [] };
    }

    return {
        id: test.id || `${setId}-T${idx}`,
        name: test.name || test.prompt || `Test ${idx + 1}`,
        prompt: test.prompt,
        expectedActivations: Array.isArray(test.expectedActivations) ? test.expectedActivations : [],
        expectedResponse: test.expectedResponse
    };
};

const mapRowToTestSet = (row: any): TestSet => {
    return {
        id: row.id,
        name: row.name,
        description: row.description || '',
        tests: row.tests ? JSON.parse(row.tests) : [],
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
};

export const testService = {
  
  // --- Test Set Management ---

  listTestSets: async (): Promise<TestSet[]> => {
    const rows = sqliteService.all(`SELECT * FROM kv_store WHERE key LIKE 'sz:test_set:%'`);
    if (rows.length === 0) {
        const defaultSet: TestSet = {
            id: 'default',
            name: 'Core System Invariants',
            description: 'Standard boot and integrity checks.',
            tests: DEFAULT_TESTS,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        await testService.createOrUpdateTestSet(defaultSet);
        return [defaultSet];
    }

    return rows.map(r => mapRowToTestSet(JSON.parse(r.value)))
               .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  },

  getTestSet: async (id: string): Promise<TestSet | null> => {
    const row = sqliteService.get(`SELECT value FROM kv_store WHERE key = ?`, [`sz:test_set:${id}`]);
    return row ? mapRowToTestSet(JSON.parse(row.value)) : null;
  },

  createOrUpdateTestSet: async (set: TestSet): Promise<void> => {
    if (!set.id) set.id = `TS-${Date.now()}`;
    set.createdAt = set.createdAt || new Date().toISOString();
    set.updatedAt = new Date().toISOString();
    set.tests = (set.tests || []).map((t, idx) => normalizeTestCase(t, idx, set.id));

    sqliteService.run(
        `INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)`,
        [`sz:test_set:${set.id}`, JSON.stringify(set)]
    );
  },

  deleteTestSet: async (id: string): Promise<void> => {
    sqliteService.run(`DELETE FROM kv_store WHERE key = ?`, [`sz:test_set:${id}`]);
  },

  replaceAllTestSets: async (sets: TestSet[]): Promise<void> => {
      const existing = await testService.listTestSets();
      for (const s of existing) {
          await testService.deleteTestSet(s.id);
      }
      for (const set of sets) {
          await testService.createOrUpdateTestSet(set);
      }
  },

  // --- Test Run Management (Simplified for Desktop) ---

  listTestRuns: async (): Promise<TestRun[]> => {
    const rows = sqliteService.all(`SELECT * FROM kv_store WHERE key LIKE 'sz:test_run:%' AND key NOT LIKE 'sz:test_run_result:%'`);
    return rows.map(r => JSON.parse(r.value))
               .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  }
};
