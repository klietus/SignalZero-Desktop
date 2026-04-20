import { sqliteService } from './sqliteService.js';
import { documentMeaningService } from './documentMeaningService.js';
import { randomUUID } from 'crypto';
import fs from 'fs';
import { loggerService, LogCategory } from './loggerService.js';

export interface Attachment {
    id: string;
    filename: string;
    mime_type: string;
    size: number;
    content: string;
    structured_data?: any;
    image_base64?: string;
    created_at?: string;
}

export const attachmentService = {
    async processAndSave(filePath: string, originalName: string, mimeType: string): Promise<Attachment> {
        try {
            const stats = fs.statSync(filePath);
            const buffer = fs.readFileSync(filePath);
            
            // 1. Parse meaning
            const normalized = await documentMeaningService.parse(buffer, mimeType, filePath);
            
            const attachment: Attachment = {
                id: `att-${randomUUID()}`,
                filename: originalName,
                mime_type: mimeType,
                size: stats.size,
                content: normalized.content,
                structured_data: normalized.structured_data,
                image_base64: normalized.metadata?.base64
            };

            // 2. Persist to SQLite
            sqliteService.run(
                `INSERT INTO attachments (id, filename, mime_type, size, content, structured_data, image_base64) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    attachment.id, 
                    attachment.filename, 
                    attachment.mime_type, 
                    attachment.size, 
                    attachment.content, 
                    JSON.stringify(attachment.structured_data),
                    attachment.image_base64 || null
                ]
            );

            loggerService.catInfo(LogCategory.SYSTEM, `Processed and saved attachment: ${attachment.filename} (${attachment.id})`);
            return attachment;
        } catch (error) {
            loggerService.catError(LogCategory.SYSTEM, "Failed to process attachment", { filePath, error });
            throw error;
        }
    },

    async processAndSaveBase64(base64Data: string, filename: string, mimeType: string): Promise<Attachment> {
        try {
            const buffer = Buffer.from(base64Data, 'base64');
            
            // 1. Parse meaning
            const normalized = await documentMeaningService.parse(buffer, mimeType, filename);
            
            const attachment: Attachment = {
                id: `att-${randomUUID()}`,
                filename: filename,
                mime_type: mimeType,
                size: buffer.length,
                content: normalized.content,
                structured_data: normalized.structured_data,
                image_base64: base64Data
            };

            // 2. Persist to SQLite
            sqliteService.run(
                `INSERT INTO attachments (id, filename, mime_type, size, content, structured_data, image_base64) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    attachment.id, 
                    attachment.filename, 
                    attachment.mime_type, 
                    attachment.size, 
                    attachment.content, 
                    JSON.stringify(attachment.structured_data),
                    attachment.image_base64 || null
                ]
            );

            loggerService.catInfo(LogCategory.SYSTEM, `Processed and saved base64 attachment: ${attachment.filename} (${attachment.id})`);
            return attachment;
        } catch (error) {
            loggerService.catError(LogCategory.SYSTEM, "Failed to process base64 attachment", { filename, error });
            throw error;
        }
    },

    async getAttachment(id: string): Promise<Attachment | null> {
        const row = sqliteService.get(`SELECT * FROM attachments WHERE id = ?`, [id]);
        if (!row) return null;

        return {
            ...row,
            structured_data: row.structured_data ? JSON.parse(row.structured_data) : undefined
        };
    },

    async deleteAttachment(id: string): Promise<void> {
        sqliteService.run(`DELETE FROM attachments WHERE id = ?`, [id]);
    }
};
