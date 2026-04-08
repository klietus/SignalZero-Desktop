import { MonitoringSourceConfig } from '../../../types.js';
import { MonitoringProvider } from '../types.js';
import { loggerService, LogCategory } from '../../loggerService.js';

export class AcledProvider implements MonitoringProvider {
    private token: string | null = null;
    private expires: number = 0;

    async poll(config: MonitoringSourceConfig): Promise<string> {
        const token = await this.getToken(config);
        
        const resp = await fetch(config.url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!resp.ok) {
            throw new Error(`ACLED Poll failed: ${resp.status} ${resp.statusText}`);
        }

        const data = await resp.json();
        return JSON.stringify(data);
    }

    private async getToken(config: MonitoringSourceConfig): Promise<string> {
        if (this.token && this.expires > Date.now() + 60000) {
            return this.token;
        }

        const email = config.metadata?.email;
        const password = config.metadata?.apiKey;

        if (!email || !password) {
            throw new Error("ACLED requires both email and password (set in API Key field)");
        }

        loggerService.catInfo(LogCategory.MONITORING, "ACLED Provider: Fetching new access token...");
        
        const resp = await fetch("https://acleddata.com/oauth/token", {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                username: email,
                password: password,
                grant_type: 'password',
                client_id: 'acled'
            })
        });

        if (!resp.ok) {
            throw new Error(`ACLED Auth failed: ${resp.status}`);
        }

        const data = await resp.json();
        this.token = data.access_token;
        this.expires = Date.now() + (data.expires_in * 1000);
        
        return this.token!;
    }
}
