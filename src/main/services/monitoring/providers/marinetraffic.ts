import { MonitoringSourceConfig } from '../../../types.js';
import { MonitoringProvider } from '../types.js';
import { loggerService, LogCategory } from '../../loggerService.js';

export class MarineTrafficProvider implements MonitoringProvider {
    async poll(config: MonitoringSourceConfig): Promise<string> {
        let url = config.url;
        const apiKey = config.metadata?.apiKey;
        if (apiKey) url = url.replace('YOUR_KEY', apiKey);

        const timeout = config.timeoutMs || 60000;
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);

        loggerService.catDebug(LogCategory.MONITORING, `Marine Traffic Provider: Fetching from ${url.replace(apiKey || '', '***')}`);
        
        try {
            const resp = await fetch(url, { signal: controller.signal });
            clearTimeout(id);

            if (!resp.ok) {
                throw new Error(`Marine Traffic Poll failed: ${resp.status}`);
            }

            const data = await resp.json();
            loggerService.catInfo(LogCategory.MONITORING, "Marine Traffic Provider: Successfully received data");
            return JSON.stringify(data);
        } catch (error: any) {
            clearTimeout(id);
            loggerService.catError(LogCategory.MONITORING, "Marine Traffic Poll exception", { error: error.message });
            throw error;
        }
    }
}
