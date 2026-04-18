import BetterSqlite3 from 'better-sqlite3';
import { join } from 'path';
import { app } from 'electron';
import fs from 'fs';
import { loggerService, LogCategory } from './loggerService.js';

let db: BetterSqlite3.Database;
let isInitialized = false;

const migrateSchema = () => {
    // Add missing columns to symbols table if they don't exist
    const tableInfo = db.prepare("PRAGMA table_info(symbols)").all() as any[];
    const columnNames = tableInfo.map(info => info.name);

    const requiredColumns = [
        { name: 'lattice', type: 'TEXT' },
        { name: 'persona', type: 'TEXT' },
        { name: 'data', type: 'TEXT' },
        { name: 'invocations', type: 'TEXT' }
    ];

    for (const col of requiredColumns) {
        if (!columnNames.includes(col.name)) {
            if (loggerService) loggerService.catInfo(LogCategory.SQLITE, `Migrating: Adding ${col.name} column to symbols table`);
            try {
                db.exec(`ALTER TABLE symbols ADD COLUMN ${col.name} ${col.type}`);
            } catch (err) {
                if (loggerService) loggerService.catError(LogCategory.SQLITE, `Migration failed for column ${col.name}`, { error: err });
            }
        }
    }

    // Add missing columns to agents table
    const agentTableInfo = db.prepare("PRAGMA table_info(agents)").all() as any[];
    const agentColumnNames = agentTableInfo.map(info => info.name);
    if (!agentColumnNames.includes('subscriptions')) {
        if (loggerService) loggerService.catInfo(LogCategory.SQLITE, 'Migrating: Adding subscriptions column to agents table');
        try {
            db.exec("ALTER TABLE agents ADD COLUMN subscriptions TEXT");
        } catch (err) {
            if (loggerService) loggerService.catError(LogCategory.SQLITE, 'Migration failed for column subscriptions', { error: err });
        }
    }

    // Add missing columns to monitoring_deltas table
    const deltaTableInfo = db.prepare("PRAGMA table_info(monitoring_deltas)").all() as any[];
    if (!deltaTableInfo.some(col => col.name === 'metadata')) {
        if (loggerService) loggerService.catInfo(LogCategory.SQLITE, 'Migrating: Adding metadata column to monitoring_deltas');
        try {
            db.exec("ALTER TABLE monitoring_deltas ADD COLUMN metadata TEXT");
        } catch (err) {
            if (loggerService) loggerService.catError(LogCategory.SQLITE, 'Migration failed for column metadata in monitoring_deltas', { error: err });
        }
    }

    // Add missing columns to monitoring_article_cache
    const cacheTableInfo = db.prepare("PRAGMA table_info(monitoring_article_cache)").all() as any[];
    if (!cacheTableInfo.some(col => col.name === 'metadata')) {
        if (loggerService) loggerService.catInfo(LogCategory.SQLITE, 'Migrating: Adding metadata column to monitoring_article_cache');
        try {
            db.exec("ALTER TABLE monitoring_article_cache ADD COLUMN metadata TEXT");
        } catch (err) {
            if (loggerService) loggerService.catError(LogCategory.SQLITE, 'Migration failed for column metadata in monitoring_article_cache', { error: err });
        }
    }

    // Add missing columns to attachments table
    const attTableInfo = db.prepare("PRAGMA table_info(attachments)").all() as any[];
    if (!attTableInfo.some(col => col.name === 'image_base64')) {
        if (loggerService) loggerService.catInfo(LogCategory.SQLITE, 'Migrating: Adding image_base64 column to attachments');
        try {
            db.exec("ALTER TABLE attachments ADD COLUMN image_base64 TEXT");
        } catch (err) {
            if (loggerService) loggerService.catError(LogCategory.SQLITE, 'Migration failed for column image_base64 in attachments', { error: err });
        }
    }

    // Ensure monitoring_article_cache exists
    db.exec(`
        CREATE TABLE IF NOT EXISTS monitoring_article_cache (
            source_id TEXT NOT NULL,
            article_id TEXT NOT NULL,
            summary TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (source_id, article_id)
        );
    `);
};

const initDb = () => {
    if (isInitialized) return;

    const isTest = process.env.NODE_ENV === 'test';
    
    if (isTest) {
        if (loggerService) loggerService.catInfo(LogCategory.SQLITE, 'Initializing In-Memory SQLite Database for Tests');
        db = new BetterSqlite3(':memory:');
    } else {
        const userDataPath = app.getPath('userData');
        const dbPath = join(userDataPath, 'signalzero.db');
        if (loggerService) loggerService.catInfo(LogCategory.SQLITE, 'Initializing SQLite Database', { dbPath });
        
        if (!fs.existsSync(userDataPath)) {
            fs.mkdirSync(userDataPath, { recursive: true });
        }
        db = new BetterSqlite3(dbPath);
    }

    try {
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');

        if (!isTest) {
            if (loggerService) loggerService.catDebug(LogCategory.SQLITE, 'Database connected');
        }

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
                invocations TEXT, -- JSON array
                lattice TEXT, -- JSON object
                persona TEXT, -- JSON object
                data TEXT, -- JSON object
                facets TEXT, -- JSON object
                activation_conditions TEXT, -- JSON array
                failure_mode TEXT,
                symbol_tag TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
            );

            -- Symbol Relationships (Normalized Links)
            CREATE TABLE IF NOT EXISTS symbol_links (
                source_id TEXT NOT NULL,
                target_id TEXT NOT NULL,
                link_type TEXT DEFAULT 'relates_to',
                bidirectional INTEGER DEFAULT 0,
                PRIMARY KEY (source_id, target_id, link_type),
                FOREIGN KEY (source_id) REFERENCES symbols(id) ON DELETE CASCADE,
                FOREIGN KEY (target_id) REFERENCES symbols(id) ON DELETE CASCADE
            );

            -- Contexts (Sessions)
            CREATE TABLE IF NOT EXISTS contexts (
                id TEXT PRIMARY KEY,
                name TEXT,
                summary TEXT,
                type TEXT DEFAULT 'conversation',
                status TEXT DEFAULT 'open',
                active_message_id TEXT,
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
                tool_call_id TEXT,
                tool_name TEXT,
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
                status TEXT DEFAULT 'completed',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (context_id) REFERENCES contexts(id) ON DELETE CASCADE
            );

            -- Agents
            CREATE TABLE IF NOT EXISTS agents (
                id TEXT PRIMARY KEY,
                prompt TEXT NOT NULL,
                schedule TEXT,
                enabled INTEGER DEFAULT 1,
                subscriptions TEXT, -- JSON array of keywords/trigger phrases
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            -- Agent Execution Logs
            CREATE TABLE IF NOT EXISTS agent_execution_logs (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                finished_at DATETIME,
                status TEXT,
                trace_count INTEGER DEFAULT 0,
                log_file_path TEXT,
                response_preview TEXT,
                error TEXT,
                FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
            );

            -- Track which deltas each agent has already processed
            CREATE TABLE IF NOT EXISTS agent_processed_deltas (
                agent_id TEXT NOT NULL,
                delta_id TEXT NOT NULL,
                processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (agent_id, delta_id),
                FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
                FOREIGN KEY (delta_id) REFERENCES monitoring_deltas(id) ON DELETE CASCADE
            );

            -- Monitoring Deltas
            CREATE TABLE IF NOT EXISTS monitoring_deltas (
                id TEXT PRIMARY KEY,
                source_id TEXT NOT NULL,
                period TEXT NOT NULL, -- hour, day, week, month, year
                content TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                metadata TEXT -- JSON object
            );

            -- Monitoring Article Cache
            CREATE TABLE IF NOT EXISTS monitoring_article_cache (
                source_id TEXT NOT NULL,
                article_id TEXT NOT NULL,
                summary TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                metadata TEXT, -- JSON object
                PRIMARY KEY (source_id, article_id)
            );

            -- Media Cache (for image descriptions)
            CREATE TABLE IF NOT EXISTS media_cache (
                hash TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                metadata TEXT, -- JSON object (model, contentType, etc.)
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            -- Attachments
            CREATE TABLE IF NOT EXISTS attachments (
                id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                mime_type TEXT,
                size INTEGER,
                content TEXT, -- Extracted text content
                structured_data TEXT, -- JSON vision analysis or other metadata
                image_base64 TEXT, -- Full image data if applicable
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            -- Simple Key-Value Store (for legacy/settings support)
            CREATE TABLE IF NOT EXISTS kv_store (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Migration for existing tables
        migrateSchema();

        if (loggerService) loggerService.catInfo(LogCategory.SQLITE, 'Database schema initialized');
        isInitialized = true;
    } catch (error) {
        if (loggerService) loggerService.catError(LogCategory.SQLITE, 'Failed to initialize database', { error });
        throw error;
    }
};

export const sqliteService = {
    db: (): BetterSqlite3.Database => {
        initDb();
        return db;
    },

    // Entity-agnostic helpers
    run: (sql: string, params: any = []): BetterSqlite3.RunResult => {
        initDb();
        // loggerService.catDebug(LogCategory.SQLITE, 'SQL RUN', { sql, params });
        try {
            return db.prepare(sql).run(params);
        } catch (error) {
            if (loggerService) loggerService.catError(LogCategory.SQLITE, 'SQL RUN ERROR', { sql, params, error });
            throw error;
        }
    },

    get: (sql: string, params: any = []): any => {
        initDb();
        // loggerService.catDebug(LogCategory.SQLITE, 'SQL GET', { sql, params });
        try {
            const result = db.prepare(sql).get(params);
            if (!result) {
                // loggerService.catDebug(LogCategory.SQLITE, 'SQL GET: No result found', { sql, params });
            }
            return result;
        } catch (error) {
            if (loggerService) loggerService.catError(LogCategory.SQLITE, 'SQL GET ERROR', { sql, params, error });
            throw error;
        }
    },

    all: (sql: string, params: any = []): any[] => {
        initDb();
        // loggerService.catDebug(LogCategory.SQLITE, 'SQL ALL', { sql, params });
        try {
            const results = db.prepare(sql).all(params);
            // loggerService.catDebug(LogCategory.SQLITE, `SQL ALL: Returned ${results.length} rows`);
            return results;
        } catch (error) {
            if (loggerService) loggerService.catError(LogCategory.SQLITE, 'SQL ALL ERROR', { sql, params, error });
            throw error;
        }
    },

    transaction: <T extends (...args: any[]) => any>(fn: T): T => {
        initDb();
        // loggerService.catDebug(LogCategory.SQLITE, 'SQL TRANSACTION START');
        return db.transaction(fn) as any;
    },

    // Legacy support for SET/GET style during transition
    async request(command: any[]): Promise<any> {
        initDb();
        const [cmd, ...args] = command;
        const cmdUpper = cmd.toUpperCase();

        switch (cmdUpper) {
            case 'SET':
                return db.prepare('INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)').run(args[0], args[1]).changes;
            case 'GET':
                const row = db.prepare('SELECT value FROM kv_store WHERE key = ?').get(args[0]) as any;
                return row ? row.value : null;
            case 'DEL':
                return db.prepare('DELETE FROM kv_store WHERE key = ?').run(args[0]).changes;
            case 'EXISTS':
                return db.prepare('SELECT 1 FROM kv_store WHERE key = ?').get(args[0]) ? 1 : 0;
            case 'SADD':
                return 1; // Simplified legacy sadd
            case 'SREM':
                return 1; // Simplified legacy srem
            case 'SMEMBERS':
                return []; // Simplified legacy smembers
            default:
                throw new Error(`SqliteService: Unsupported legacy command: ${cmdUpper}`);
        }
    },

    // Test helper to clear state
    __sqliteTestUtils: {
        reset: () => {
            initDb();
            // Clear all data relational tables
            db.transaction(() => {
                db.prepare(`DELETE FROM symbol_links`).run();
                db.prepare(`DELETE FROM symbols`).run();
                db.prepare(`DELETE FROM domains`).run();
                db.prepare(`DELETE FROM messages`).run();
                db.prepare(`DELETE FROM traces`).run();
                db.prepare(`DELETE FROM contexts`).run();
                db.prepare(`DELETE FROM agents`).run();
                db.prepare(`DELETE FROM kv_store`).run();
            })();
        }
    }
};
