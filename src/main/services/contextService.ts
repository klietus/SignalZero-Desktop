import { sqliteService } from './sqliteService.js';
import { loggerService } from './loggerService.js';
import { symbolCacheService } from './symbolCacheService.js';
import { ContextMessage, ContextSession, ContextHistoryGroup } from '../types.js';
import { randomUUID } from 'crypto';

const generateId = () => `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const mapRowToSession = (row: any): ContextSession => ({
    id: row.id,
    name: row.name,
    summary: row.summary,
    type: row.type as any,
    status: row.status as any,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
    metadata: row.metadata ? JSON.parse(row.metadata) : {}
});

const mapRowToMessage = (row: any): ContextMessage => ({
    id: row.id,
    role: row.role,
    content: row.content,
    timestamp: row.timestamp,
    toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : [],
    correlationId: row.correlation_id
});

export const contextService = {
  async createSession(
    type: ContextSession['type'], 
    metadata?: Record<string, any>, 
    name?: string
  ): Promise<ContextSession> {
    const id = generateId();
    const now = new Date().toISOString();
    
    sqliteService.run(
        `INSERT INTO contexts (id, name, type, status, created_at, updated_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, name || `Context ${new Date().toLocaleTimeString()}`, type, 'open', now, now, JSON.stringify(metadata || {})]
    );

    const session = await this.getSession(id);
    if (!session) throw new Error("Failed to create session");
    return session;
  },

  async listSessions(): Promise<ContextSession[]> {
    const rows = sqliteService.all(`SELECT * FROM contexts ORDER BY updated_at DESC`);
    return rows.map(mapRowToSession);
  },

  async getSession(id: string): Promise<ContextSession | null> {
    const row = sqliteService.get(`SELECT * FROM contexts WHERE id = ?`, [id]);
    return row ? mapRowToSession(row) : null;
  },

  async closeSession(id: string): Promise<ContextSession | null> {
    const now = new Date().toISOString();
    sqliteService.run(
        `UPDATE contexts SET status = 'closed', closed_at = ?, updated_at = ? WHERE id = ?`,
        [now, now, id]
    );
    await symbolCacheService.clearCache(id);
    return this.getSession(id);
  },

  async deleteSession(id: string): Promise<boolean> {
    const result = sqliteService.run(`DELETE FROM contexts WHERE id = ?`, [id]);
    return result.changes > 0;
  },

  async getHistory(sessionId: string): Promise<ContextMessage[]> {
    const rows = sqliteService.all(
        `SELECT * FROM messages WHERE context_id = ? ORDER BY timestamp ASC`,
        [sessionId]
    );
    return rows.map(mapRowToMessage);
  },

  async getUnfilteredHistory(sessionId: string): Promise<ContextMessage[]> {
    return this.getHistory(sessionId);
  },

  async recordMessage(sessionId: string, message: ContextMessage): Promise<void> {
    const now = new Date().toISOString();
    
    sqliteService.run(
        `INSERT INTO messages (id, context_id, role, content, tool_calls, timestamp, correlation_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            message.id || randomUUID(),
            sessionId,
            message.role,
            message.content || "",
            JSON.stringify(message.toolCalls || []),
            message.timestamp || now,
            message.correlationId || null
        ]
    );

    sqliteService.run(`UPDATE contexts SET updated_at = ? WHERE id = ?`, [now, sessionId]);
  },

  async updateSession(session: ContextSession): Promise<void> {
    sqliteService.run(
        `UPDATE contexts SET name = ?, summary = ?, metadata = ?, updated_at = ? WHERE id = ?`,
        [
            session.name,
            session.summary,
            JSON.stringify(session.metadata || {}),
            new Date().toISOString(),
            session.id
        ]
    );
  },

  async renameSession(sessionId: string, name: string): Promise<ContextSession | null> {
    sqliteService.run(
        `UPDATE contexts SET name = ?, updated_at = ? WHERE id = ?`,
        [name, new Date().toISOString(), sessionId]
    );
    return this.getSession(sessionId);
  }
};
