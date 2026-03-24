import Database from 'better-sqlite3';
import { join } from 'path';
import { app } from 'electron';
import fs from 'fs';

let db: Database.Database;

const initDb = () => {
    if (db) return;

    const userDataPath = app.getPath('userData');
    const dbPath = join(userDataPath, 'signalzero.db');
    
    if (!fs.existsSync(userDataPath)) {
        fs.mkdirSync(userDataPath, { recursive: true });
    }

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Normalized Schema
    db.exec(`
        -- Domains
        CREATE TABLE IF NOT EXISTS domains (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            invariants TEXT, -- JSON array
            enabled INTEGER DEFAULT 1,
            read_only INTEGER DEFAULT 0,
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Symbols
        CREATE TABLE IF NOT EXISTS symbols (
            id TEXT PRIMARY KEY,
            domain_id TEXT NOT NULL,
            name TEXT NOT NULL,
            kind TEXT DEFAULT 'pattern',
            triad TEXT,
            role TEXT,
            macro TEXT,
            facets TEXT, -- JSON object
            activation_conditions TEXT, -- JSON array
            failure_mode TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
        );

        -- Symbol Relationships (Normalized Links)
        CREATE TABLE IF NOT EXISTS symbol_links (
            source_id TEXT,
            target_id TEXT,
            link_type TEXT DEFAULT 'relates_to',
            bidirectional INTEGER DEFAULT 0,
            PRIMARY KEY (source_id, target_id, link_type),
            FOREIGN KEY (source_id) REFERENCES symbols(id) ON DELETE CASCADE
        );

        -- Contexts (Sessions)
        CREATE TABLE IF NOT EXISTS contexts (
            id TEXT PRIMARY KEY,
            name TEXT,
            summary TEXT,
            type TEXT DEFAULT 'conversation',
            status TEXT DEFAULT 'open',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            closed_at DATETIME,
            metadata TEXT -- JSON object
        );

        -- Messages
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            context_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT,
            tool_calls TEXT, -- JSON array
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            correlation_id TEXT,
            FOREIGN KEY (context_id) REFERENCES contexts(id) ON DELETE CASCADE
        );

        -- Traces
        CREATE TABLE IF NOT EXISTS traces (
            id TEXT PRIMARY KEY,
            context_id TEXT,
            entry_node TEXT,
            output_node TEXT,
            activation_path TEXT, -- JSON array
            source_context TEXT, -- JSON object
            status TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (context_id) REFERENCES contexts(id) ON DELETE SET NULL
        );

        -- Agents
        CREATE TABLE IF NOT EXISTS agents (
            id TEXT PRIMARY KEY,
            prompt TEXT NOT NULL,
            schedule TEXT,
            enabled INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_run_at DATETIME
        );

        -- General Key-Value (for settings and small state)
        CREATE TABLE IF NOT EXISTS kv_store (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
};

export const sqliteService = {
    db: () => {
        initDb();
        return db;
    },

    // Entity-agnostic helpers
    run: (sql: string, params: any = []) => {
        initDb();
        return db.prepare(sql).run(params);
    },

    get: (sql: string, params: any = []) => {
        initDb();
        return db.prepare(sql).get(params);
    },

    all: (sql: string, params: any = []) => {
        initDb();
        return db.prepare(sql).all(params);
    },

    transaction: (fn: (...args: any[]) => any) => {
        initDb();
        return db.transaction(fn);
    },

    // Legacy support for SET/GET style during transition
    async request(command: any[]): Promise<any> {
        initDb();
        const [cmd, ...args] = command;
        const cmdUpper = cmd.toUpperCase();

        switch (cmdUpper) {
            case 'GET':
                const row = db.prepare('SELECT value FROM kv_store WHERE key = ?').get(args[0]) as any;
                return row ? row.value : null;
            case 'SET':
                db.prepare('INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)').run(args[0], String(args[1]));
                return 'OK';
            case 'DEL':
                return db.prepare('DELETE FROM kv_store WHERE key = ?').run(args[0]).changes;
            case 'EXISTS':
                return db.prepare('SELECT 1 FROM kv_store WHERE key = ?').get(args[0]) ? 1 : 0;
            default:
                throw new Error(`SqliteService: Unsupported legacy command: ${cmdUpper}`);
        }
    },

    healthCheck: async (): Promise<boolean> => {
        try {
            initDb();
            db.prepare('SELECT 1').get();
            return true;
        } catch (e) {
            return false;
        }
    },

    __sqliteTestUtils: {
        reset: () => {
            initDb();
            db.exec(`
                DELETE FROM symbol_links;
                DELETE FROM symbols;
                DELETE FROM domains;
                DELETE FROM messages;
                DELETE FROM traces;
                DELETE FROM contexts;
                DELETE FROM agents;
                DELETE FROM kv_store;
            `);
        }
    }
};
