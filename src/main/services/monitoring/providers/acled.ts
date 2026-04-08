import { MonitoringSourceConfig } from '../../../types.js';
import { MonitoringProvider } from '../types.js';
import { loggerService, LogCategory } from '../../loggerService.js';

export class AcledProvider implements MonitoringProvider {
    private token: string | null = null;
    private expires: number = 0;

    async poll(config: MonitoringSourceConfig): Promise<string> {
        try {
            const token = await this.getToken(config);
            
            loggerService.catDebug(LogCategory.MONITORING, `ACLED Provider: Polling data from ${config.url}`);
            const resp = await fetch(config.url, {
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json',
                    'User-Agent': 'SignalZero-Desktop/1.0'
                }
            });

            if (!resp.ok) {
                const errText = await resp.text();
                loggerService.catError(LogCategory.MONITORING, `ACLED Data Poll failed: ${resp.status}`, { error: errText });
                throw new Error(`ACLED Poll failed: ${resp.status} ${resp.statusText}`);
            }

            const data = await resp.json();
            return JSON.stringify(data);
        } catch (error: any) {
            loggerService.catError(LogCategory.MONITORING, "ACLED Poll exception", { 
                error: error.message,
                stack: error.stack,
                cause: error.cause
            });
            throw error;
        }
    }

    private async getToken(config: MonitoringSourceConfig): Promise<string> {
        if (this.token && this.expires > Date.now() + 60000) {
            return this.token;
        }

        const email = config.metadata?.email;
        const password = config.metadata?.apiKey;

        if (!email || !password) {
            const err = "ACLED requires both email and password (set in API Key field)";
            loggerService.catError(LogCategory.MONITORING, err);
            throw new Error(err);
        }

        loggerService.catInfo(LogCategory.MONITORING, "ACLED Provider: Fetching new access token...", { email: email.replace(/(?<=.{2}).(?=.*@)/g, '*') });
        
        try {
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
                const errText = await resp.text();
                loggerService.catError(LogCategory.MONITORING, `ACLED Auth failed: ${resp.status}`, { error: errText });
                throw new Error(`ACLED Auth failed: ${resp.status} ${errText}`);
            }

            const data = await resp.json();
            if (!data.access_token) {
                loggerService.catError(LogCategory.MONITORING, "ACLED Auth response missing access_token", { data });
                throw new Error("ACLED Auth failed: No access_token returned");
            }

            this.token = data.access_token;
            this.expires = Date.now() + (data.expires_in * 1000);
            
            loggerService.catInfo(LogCategory.MONITORING, "ACLED Provider: Successfully obtained token");
            return this.token!;
        } catch (error: any) {
            loggerService.catError(LogCategory.MONITORING, "ACLED Auth exception", { error: error.message });
            throw error;
        }
    }
}
