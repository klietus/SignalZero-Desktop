import { MonitoringSourceConfig } from '../../../types.js';
import { MonitoringProvider } from '../types.js';
import { loggerService, LogCategory } from '../../loggerService.js';

export class NyTimesProvider implements MonitoringProvider {
    async poll(config: MonitoringSourceConfig): Promise<string> {
        const timeout = config.timeoutMs || 60000;
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);

        loggerService.catDebug(LogCategory.MONITORING, `NYT Provider: Fetching RSS from ${config.url}`);
        
        try {
            const resp = await fetch(config.url, { signal: controller.signal });
            clearTimeout(id);

            if (!resp.ok) {
                throw new Error(`NYT Poll failed: ${resp.status}`);
            }

            const text = await resp.text();
            loggerService.catInfo(LogCategory.MONITORING, `NYT Provider: Successfully received RSS (${text.length} bytes)`);
            return text;
        } catch (error: any) {
            clearTimeout(id);
            loggerService.catError(LogCategory.MONITORING, "NYT Poll exception", { error: error.message });
            throw error;
        }
    }
}
