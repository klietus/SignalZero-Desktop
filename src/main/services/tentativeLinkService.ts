import { sqliteService } from './sqliteService.js';

const TENTATIVE_LINKS_KEY = 'sz:tentative_links';

export const tentativeLinkService = {
    async incrementTurns(): Promise<void> {
        // Logic to decay/increment turns for tentative links
        // For now, a simple placeholder mirroring the local node API
    },
    
    async addLink(link: any): Promise<void> {
        const currentRaw = await sqliteService.request(['GET', TENTATIVE_LINKS_KEY]);
        const current = currentRaw ? JSON.parse(currentRaw) : [];
        current.push(link);
        await sqliteService.request(['SET', TENTATIVE_LINKS_KEY, JSON.stringify(current)]);
    }
};
