import { sqliteService } from './sqliteService.js';
import { symbolCacheService } from './symbolCacheService.js';
import { attachmentService } from './attachmentService.js';
import { eventBusService, KernelEventType } from './eventBusService.js';
import { ContextMessage, ContextSession } from '../types.js';
import { randomUUID } from 'crypto';

const generateId = () => `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const mapRowToSession = (row: any): ContextSession => ({
    id: row.id,
    name: row.name,
    summary: row.summary,
    type: row.type as any,
    status: row.status as any,
    activeMessageId: row.active_message_id || null,
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
    correlationId: row.correlation_id,
    toolCallId: row.tool_call_id,
    toolName: row.tool_name,
    metadata: row.metadata ? JSON.parse(row.metadata) : {}
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
        `INSERT INTO contexts (id, name, type, status, active_message_id, summary, closed_at, created_at, updated_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, name || `Context ${new Date().toLocaleTimeString()}`, type, 'open', null, null, null, now, now, JSON.stringify(metadata || {})]
    );

    const session = await this.getSession(id);
    if (!session) throw new Error("Failed to create session");
    
    eventBusService.emitKernelEvent(KernelEventType.CONTEXT_CREATED, session);
    
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

  async getHistory(sessionId: string): Promise<ContextMessage[]> {
    const rows = sqliteService.all(`SELECT * FROM messages WHERE context_id = ? ORDER BY timestamp ASC`, [sessionId]);
    return rows.map(mapRowToMessage);
  },

  async getUnfilteredHistory(sessionId: string): Promise<ContextMessage[]> {
    return this.getHistory(sessionId);
  },

  async setActiveMessage(sessionId: string, messageId: string | null): Promise<void> {
    sqliteService.run(
        `UPDATE contexts SET active_message_id = ?, updated_at = ? WHERE id = ?`,
        [messageId, new Date().toISOString(), sessionId]
    );
  },

  async hasActiveMessage(sessionId: string): Promise<boolean> {
    const session = await this.getSession(sessionId);
    return !!session?.activeMessageId;
  },

  async deleteSession(id: string): Promise<boolean> {
    try {
        // 1. Find all attachments linked to this session's messages
        const messages = sqliteService.all(`SELECT content, metadata FROM messages WHERE context_id = ?`, [id]);
        const attachmentIds = new Set<string>();
        
        for (const msg of messages) {
            // Check content (legacy support)
            if (msg.content) {
                const match = msg.content.match(/<attachments>([\s\S]*?)<\/attachments>/);
                if (match) {
                    try {
                        const atts = JSON.parse(match[1]);
                        if (Array.isArray(atts)) {
                            atts.forEach(a => { if (a.id) attachmentIds.add(a.id); });
                        }
                    } catch (e) { /* ignore parse errors */ }
                }
            }

            // Check metadata (new way)
            if (msg.metadata) {
                try {
                    const meta = JSON.parse(msg.metadata);
                    if (Array.isArray(meta.attachments)) {
                        meta.attachments.forEach((a: any) => { if (a.id) attachmentIds.add(a.id); });
                    }
                } catch (e) { /* ignore parse errors */ }
            }
        }

        // 2. Delete the attachments from the database
        for (const attId of attachmentIds) {
            await attachmentService.deleteAttachment(attId);
        }

        // 3. Delete the session (cascades to messages in DB)
        const result = sqliteService.run(`DELETE FROM contexts WHERE id = ?`, [id]);
        
        if (result.changes > 0) {
            eventBusService.emitKernelEvent(KernelEventType.CONTEXT_DELETED, { id });
            return true;
        }
        return false;
    } catch (error) {
        console.error("Failed to delete session and attachments", error);
        return false;
    }
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

  async recordMessage(sessionId: string, message: ContextMessage): Promise<void> {
    const now = new Date().toISOString();
    
    // Strip attachments from content to prevent them from being piped through history multiple times
    const cleanContent = (message.content || "")
        .replace(/<attachments>[\s\S]*?<\/attachments>/gi, '')
        .trim();

    sqliteService.run(
        `INSERT INTO messages (id, context_id, role, content, tool_calls, tool_call_id, tool_name, timestamp, correlation_id, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            message.id || randomUUID(),
            sessionId,
            message.role,
            cleanContent,
            JSON.stringify(message.toolCalls || []),
            message.toolCallId || null,
            message.toolName || null,
            message.timestamp || now,
            message.correlationId || null,
            JSON.stringify(message.metadata || {})
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
