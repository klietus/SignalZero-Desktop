import { MonitoringSourceConfig } from '../../types.js';

export interface MonitoringProvider {
    /**
     * Polling logic for a specific data source.
     * Returns raw string data (JSON, XML, or Text) to be summarized.
     */
    poll(config: MonitoringSourceConfig): Promise<string>;
}
