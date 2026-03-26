import { sqliteService } from './sqliteService.js';
import { domainService } from './domainService.js';
import { eventBusService, KernelEventType } from './eventBusService.js';
import { loggerService, LogCategory } from './loggerService.js';

export interface TentativeLink {
    sourceId: string;
    targetId: string;
    count: number;
    age: number; // turns since last reinforce
}

const TENTATIVE_LINKS_KEY = 'sz:tentative_links';

class TentativeLinkService {
    private readonly FINALIZATION_THRESHOLD = 3;
    private readonly EVICTION_AGE = 10;

    /**
     * Process a trace to identify and update tentative links.
     */
    async processTrace(activationPath: { symbol_id?: string }[]) {
        if (!activationPath || activationPath.length < 2) return;

        const links = await this.getAllLinks();
        
        for (let i = 0; i < activationPath.length - 1; i++) {
            const sourceId = activationPath[i].symbol_id;
            const targetId = activationPath[i+1].symbol_id;

            if (sourceId && targetId && sourceId !== targetId) {
                await this.handlePair(sourceId, targetId, links);
            }
        }

        await this.saveLinks(links);
    }

    private async handlePair(sourceId: string, targetId: string, links: Record<string, TentativeLink>) {
        // Check if a persistent link already exists
        const sourceSym = await domainService.findById(sourceId);
        if (sourceSym?.linked_patterns?.some(l => (typeof l === 'string' ? l : l.id) === targetId)) {
            return; // Already persistent
        }

        const linkKey = this.getLinkKey(sourceId, targetId);
        
        if (links[linkKey]) {
            // Reinforce
            links[linkKey].count += 1;
            links[linkKey].age = 0; // Reset age on reinforce

            if (links[linkKey].count >= this.FINALIZATION_THRESHOLD) {
                await this.finalizeLink(sourceId, targetId);
                delete links[linkKey];
            } else {
                loggerService.catDebug(LogCategory.KERNEL, `Reinforced tentative link: ${sourceId} -> ${targetId} (${links[linkKey].count})`);
                // Re-emit create event to trigger visual flare in frontend
                eventBusService.emitKernelEvent(KernelEventType.TENTATIVE_LINK_CREATE, links[linkKey]);
            }
        } else {
            // New tentative link
            const newLink: TentativeLink = {
                sourceId,
                targetId,
                count: 1,
                age: 0
            };
            links[linkKey] = newLink;
            loggerService.catDebug(LogCategory.KERNEL, `New tentative link detected: ${sourceId} -> ${targetId}`);
            eventBusService.emitKernelEvent(KernelEventType.TENTATIVE_LINK_CREATE, newLink);
        }
    }

    private async finalizeLink(sourceId: string, targetId: string) {
        loggerService.catInfo(LogCategory.KERNEL, `Finalizing tentative link into persistent store: ${sourceId} -> ${targetId}`);
        
        try {
            const sourceSym = await domainService.findById(sourceId);
            if (sourceSym) {
                if (!sourceSym.linked_patterns) sourceSym.linked_patterns = [];
                sourceSym.linked_patterns.push({
                    id: targetId,
                    link_type: 'emergent',
                    bidirectional: true
                });
                
                // addSymbol handles back-link creation and LINK_CREATE event emission
                await domainService.addSymbol(sourceSym.symbol_domain, sourceSym);
                
                // Emit delete for the tentative line
                eventBusService.emitKernelEvent(KernelEventType.TENTATIVE_LINK_DELETE, { sourceId, targetId });
            }
        } catch (e) {
            loggerService.catError(LogCategory.KERNEL, `Failed to finalize link ${sourceId} -> ${targetId}`, { error: e });
        }
    }

    /**
     * Increment age of all links and evict old ones.
     */
    async incrementTurns() {
        const links = await this.getAllLinks();
        let changed = false;

        for (const key in links) {
            links[key].age += 1;
            if (links[key].age >= this.EVICTION_AGE) {
                loggerService.catDebug(LogCategory.KERNEL, `Evicting decayed tentative link: ${links[key].sourceId} -> ${links[key].targetId}`);
                eventBusService.emitKernelEvent(KernelEventType.TENTATIVE_LINK_DELETE, { 
                    sourceId: links[key].sourceId, 
                    targetId: links[key].targetId 
                });
                delete links[key];
                changed = true;
            } else {
                changed = true;
            }
        }

        if (changed) await this.saveLinks(links);
    }

    private getLinkKey(s: string, t: string) {
        const sorted = [s, t].sort();
        return `${sorted[0]}:${sorted[1]}`;
    }

    private async getAllLinks(): Promise<Record<string, TentativeLink>> {
        const data = await sqliteService.request(['GET', TENTATIVE_LINKS_KEY]);
        return data ? JSON.parse(data) : {};
    }

    private async saveLinks(links: Record<string, TentativeLink>) {
        await sqliteService.request(['SET', TENTATIVE_LINKS_KEY, JSON.stringify(links)]);
    }
}

export const tentativeLinkService = new TentativeLinkService();
