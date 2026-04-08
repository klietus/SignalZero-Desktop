import { MonitoringSourceConfig } from '../../../types.js';
import { MonitoringProvider } from '../types.js';
import { loggerService, LogCategory } from '../../loggerService.js';

export class GdeltProvider implements MonitoringProvider {
    async poll(config: MonitoringSourceConfig): Promise<string> {
        const timeout = config.timeoutMs || 120000;
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);

        loggerService.catDebug(LogCategory.MONITORING, `GDELT Provider: Starting fetch from ${config.url}`, { timeout });
        
        try {
            const start = Date.now();
            const resp = await fetch(config.url, { 
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
                }
            });
            clearTimeout(id);

            if (!resp.ok) {
                const errText = await resp.text();
                loggerService.catError(LogCategory.MONITORING, `GDELT API error: ${resp.status}`, { error: errText });
                throw new Error(`GDELT Poll failed: ${resp.status} ${resp.statusText}`);
            }

            const data = await resp.json();
            const duration = Date.now() - start;
            loggerService.catInfo(LogCategory.MONITORING, `GDELT Provider: Received ${JSON.stringify(data).length} bytes in ${duration}ms`);
            
            return JSON.stringify(data);
        } catch (error: any) {
            clearTimeout(id);
            const isTimeout = error.name === 'AbortError';
            loggerService.catError(LogCategory.MONITORING, `GDELT Poll exception${isTimeout ? ' (Timeout)' : ''}`, { 
                error: error.message,
                timeout 
            });
            throw error;
        }
    }
}
