import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sqliteService } from '../services/sqliteService'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

describe('SqliteService Normalized Schema', () => {
    beforeEach(async () => {
        sqliteService.__sqliteTestUtils.reset();
    });

    it('should initialize with all required tables', () => {
        const db = sqliteService.db();
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
        
        expect(tables).toContain('domains');
        expect(tables).toContain('symbols');
        expect(tables).toContain('symbol_links');
        expect(tables).toContain('contexts');
        expect(tables).toContain('messages');
        expect(tables).toContain('traces');
        expect(tables).toContain('agents');
        expect(tables).toContain('kv_store');
    });

    it('should perform relational operations across symbols and links', () => {
        // 1. Create Domain
        sqliteService.run("INSERT INTO domains (id, name) VALUES (?, ?)", ['dom-1', 'Test Domain']);
        
        // 2. Create Symbol
        sqliteService.run("INSERT INTO symbols (id, domain_id, name) VALUES (?, ?, ?)", ['S1', 'dom-1', 'Symbol 1']);
        sqliteService.run("INSERT INTO symbols (id, domain_id, name) VALUES (?, ?, ?)", ['S2', 'dom-1', 'Symbol 2']);
        
        // 3. Create Link
        sqliteService.run("INSERT INTO symbol_links (source_id, target_id, link_type) VALUES (?, ?, ?)", ['S1', 'S2', 'depends_on']);
        
        // 4. Query Join
        const links = sqliteService.all(`
            SELECT s.name as target_name 
            FROM symbol_links l 
            JOIN symbols s ON l.target_id = s.id 
            WHERE l.source_id = ?`, 
            ['S1']
        );
        
        expect(links).toHaveLength(1);
        expect(links[0].target_name).toBe('Symbol 2');
    });

    it('should enforce foreign key cascades', () => {
        sqliteService.run("INSERT INTO domains (id, name) VALUES (?, ?)", ['dom-delete', 'Delete Me']);
        sqliteService.run("INSERT INTO symbols (id, domain_id, name) VALUES (?, ?, ?)", ['S-DEL', 'dom-delete', 'Symbol']);
        
        // Verify symbol exists
        expect(sqliteService.get("SELECT 1 FROM symbols WHERE id = ?", ['S-DEL'])).toBeDefined();
        
        // Delete domain
        sqliteService.run("DELETE FROM domains WHERE id = ?", ['dom-delete']);
        
        // Symbol should be gone due to CASCADE
        expect(sqliteService.get("SELECT 1 FROM symbols WHERE id = ?", ['S-DEL'])).toBeUndefined();
    });

    it('should maintain legacy request support for KV store', async () => {
        await sqliteService.request(['SET', 'leg-key', 'leg-val']);
        const val = await sqliteService.request(['GET', 'leg-key']);
        expect(val).toBe('leg-val');
    });
});
