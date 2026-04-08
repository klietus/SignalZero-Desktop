import { MonitoringSourceConfig } from '../../../types.js';
import { MonitoringProvider } from '../types.js';
import { loggerService, LogCategory } from '../../loggerService.js';

export class GdeltProvider implements MonitoringProvider {
    async poll(config: MonitoringSourceConfig): Promise<string> {
        const MAX_ATTEMPTS = 3;
        let lastError: any = null;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const timeout = config.timeoutMs || 120000;
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeout);

            loggerService.catDebug(LogCategory.MONITORING, `GDELT Provider: Attempt ${attempt}/${MAX_ATTEMPTS} fetch from ${config.url}`, { timeout });
            
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
                    loggerService.catError(LogCategory.MONITORING, `GDELT API error (Attempt ${attempt}): ${resp.status}`, { error: errText });
                    throw new Error(`GDELT Poll failed: ${resp.status} ${resp.statusText}`);
                }

                const data = await resp.json();
                const duration = Date.now() - start;
                loggerService.catInfo(LogCategory.MONITORING, `GDELT Provider: Received ${JSON.stringify(data).length} bytes in ${duration}ms`);
                
                return JSON.stringify(data);
            } catch (error: any) {
                clearTimeout(id);
                lastError = error;
                const isTimeout = error.name === 'AbortError';
                loggerService.catWarn(LogCategory.MONITORING, `GDELT Poll attempt ${attempt} failed${isTimeout ? ' (Timeout)' : ''}`, { 
                    error: error.message,
                    timeout 
                });

                if (attempt < MAX_ATTEMPTS) {
                    await new Promise(resolve => setTimeout(resolve, 2000)); // 2s wait before retry
                }
            }
        }

        loggerService.catError(LogCategory.MONITORING, `GDELT Provider: All ${MAX_ATTEMPTS} attempts failed.`);
        throw lastError;
    }
}
