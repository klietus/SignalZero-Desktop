import { MonitoringSourceConfig } from '../../../types.js';
import { MonitoringProvider } from '../types.js';

export class RssProvider implements MonitoringProvider {
    async poll(config: MonitoringSourceConfig): Promise<string> {
        const resp = await fetch(config.url);
        if (!resp.ok) {
            throw new Error(`RSS Poll failed: ${resp.status} ${resp.statusText}`);
        }
        return await resp.text();
    }
}
