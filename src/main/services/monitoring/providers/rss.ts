import { MonitoringSourceConfig } from '../../../types.js';
import { MonitoringProvider } from '../types.js';

export class RssProvider implements MonitoringProvider {
    async poll(config: MonitoringSourceConfig): Promise<string> {
        const timeout = config.timeoutMs || 60000;
        const resp = await fetch(config.url, { signal: AbortSignal.timeout(timeout) });
        if (!resp.ok) {
            throw new Error(`RSS Poll failed: ${resp.status} ${resp.statusText}`);
        }
        return await resp.text();
    }
}
