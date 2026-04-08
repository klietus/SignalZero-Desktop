import { MonitoringSourceConfig } from '../../../types.js';
import { MonitoringProvider } from '../types.js';

export class ApiProvider implements MonitoringProvider {
    async poll(config: MonitoringSourceConfig): Promise<string> {
        let url = config.url;
        const apiKey = config.metadata?.apiKey;

        if (apiKey) {
            if (config.id === 'alphavantage') url += `&apikey=${apiKey}`;
            else if (config.id.includes('stack')) url += `&access_key=${apiKey}`;
            else if (config.id === 'marinetraffic') url = url.replace('YOUR_KEY', apiKey);
        }

        const timeout = config.timeoutMs || 60000;
        const resp = await fetch(url, { signal: AbortSignal.timeout(timeout) });
        if (!resp.ok) {
            throw new Error(`API Poll failed: ${resp.status} ${resp.statusText}`);
        }

        const data = await resp.json();
        return JSON.stringify(data);
    }
}
