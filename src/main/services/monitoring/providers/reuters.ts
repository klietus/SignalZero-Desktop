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
            const resp = await fetch(config.url, { 
                signal: controller.signal,
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });
            clearTimeout(id);

            if (!resp.ok) {
                loggerService.catError(LogCategory.MONITORING, `Reuters Poll failed: ${resp.status}`);
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
