import { MonitoringSourceConfig } from '../../../types.js';
import { MonitoringProvider } from '../types.js';
import { loggerService, LogCategory } from '../../loggerService.js';

export class ReutersProvider implements MonitoringProvider {
    async poll(config: MonitoringSourceConfig): Promise<string> {
        const timeout = config.timeoutMs || 60000;
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);

        loggerService.catDebug(LogCategory.MONITORING, `Reuters Provider: Scraping web from ${config.url}`);
        
        try {
            const resp = await fetch(config.url, { signal: controller.signal });
            clearTimeout(id);

            if (!resp.ok) {
                throw new Error(`Reuters Poll failed: ${resp.status}`);
            }

            const text = await resp.text();
            loggerService.catInfo(LogCategory.MONITORING, `Reuters Provider: Successfully received data (${text.length} bytes)`);
            return text;
        } catch (error: any) {
            clearTimeout(id);
            loggerService.catError(LogCategory.MONITORING, "Reuters Poll exception", { error: error.message });
            throw error;
        }
    }
}
