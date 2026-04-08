import { MonitoringSourceConfig } from '../../../types.js';
import { MonitoringProvider } from '../types.js';
import { loggerService, LogCategory } from '../../loggerService.js';

export class MarketStackProvider implements MonitoringProvider {
    async poll(config: MonitoringSourceConfig): Promise<string> {
        let url = config.url;
        const apiKey = config.metadata?.apiKey;
        if (apiKey) url += `&access_key=${apiKey}`;

        const timeout = config.timeoutMs || 60000;
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);

        loggerService.catDebug(LogCategory.MONITORING, `Market Stack Provider: Fetching from ${url.replace(apiKey || '', '***')}`);
        
        try {
            const resp = await fetch(url, { signal: controller.signal });
            clearTimeout(id);

            if (!resp.ok) {
                throw new Error(`Market Stack Poll failed: ${resp.status}`);
            }

            const data = await resp.json();
            loggerService.catInfo(LogCategory.MONITORING, "Market Stack Provider: Successfully received data");
            return JSON.stringify(data);
        } catch (error: any) {
            clearTimeout(id);
            loggerService.catError(LogCategory.MONITORING, "Market Stack Poll exception", { error: error.message });
            throw error;
        }
    }
}
