import { sqliteService } from './sqliteService.js';
import { loggerService } from './loggerService.js';
import { safeStorage } from 'electron';

const SECRET_PREFIX = 'secret:';

export const secretManagerService = {
    async listSecrets() {
        const keys = await sqliteService.request(['KEYS', `${SECRET_PREFIX}*`]);
        const secrets = (keys || []).map((k: string) => ({
            id: k.replace(SECRET_PREFIX, ''),
            project_id: 'local'
        }));
        return {
            project_id: 'local',
            count: secrets.length,
            secrets
        };
    },

    async accessSecretVersion(secretId: string) {
        const encryptedHex = await sqliteService.request(['GET', `${SECRET_PREFIX}${secretId}`]);
        if (!encryptedHex) throw new Error(`Secret ${secretId} not found locally.`);
        
        let value = '';
        if (safeStorage.isEncryptionAvailable()) {
            const buffer = Buffer.from(encryptedHex, 'hex');
            value = safeStorage.decryptString(buffer);
        } else {
            // Fallback for non-supported OS versions (not ideal but for compatibility)
            value = Buffer.from(encryptedHex, 'hex').toString('utf8');
        }

        return {
            project_id: 'local',
            secret_id: secretId,
            version: '1',
            value
        };
    },

    async storeSecret(secretId: string, value: string) {
        let storedValue = value;
        if (safeStorage.isEncryptionAvailable()) {
            const encrypted = safeStorage.encryptString(value);
            storedValue = encrypted.toString('hex');
        } else {
            storedValue = Buffer.from(value).toString('hex');
        }

        await sqliteService.request(['SET', `${SECRET_PREFIX}${secretId}`, storedValue]);
        return {
            project_id: 'local',
            secret_id: secretId,
            version: '1',
            create_time: new Date().toISOString()
        };
    }
};

