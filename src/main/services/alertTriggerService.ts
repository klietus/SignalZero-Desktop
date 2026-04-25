import { randomUUID } from 'crypto';
import { DeltaAlert, AlertSeverity, AlertSource } from '../types.js';
import { uiStateService } from './uiStateService.js';
import { contextService } from './contextService.js';
import { loggerService, LogCategory } from './loggerService.js';

const ALERT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

interface AlertInput {
    source: AlertSource;
    severity: AlertSeverity;
    summary: string;
    metadata: Record<string, unknown>;
    sessionId?: string | null;
}

class AlertTriggerService {
    private alerts: DeltaAlert[] = [];
    private pendingTriggers: DeltaAlert[] = [];
    private triggerInFlight = false;

    constructor() {
        // Background cleanup
        setInterval(() => this.clearExpired(), CLEANUP_INTERVAL_MS);
    }

    /**
     * Log an alert. If critical/high severity, registers a pending trigger.
     */
    async log(alert: AlertInput): Promise<DeltaAlert> {
        const now = Date.now();
        const entry: DeltaAlert = {
            ...alert,
            id: `alert-${randomUUID()}`,
            timestamp: now,
            expiresAt: now + ALERT_TTL_MS,
            sessionId: alert.sessionId ?? null
        };

        this.alerts.push(entry);
        loggerService.catInfo(LogCategory.SYSTEM, `Alert logged: ${entry.severity} - ${entry.summary}`);

        // Only auto-trigger on high/critical
        if (alert.severity === 'high' || alert.severity === 'critical') {
            await this.registerTrigger(alert);
        }

        return entry;
    }

    /**
     * Log an alert with an explicit session target.
     */
    async logForSession(alert: Omit<AlertInput, 'sessionId'>, sessionId: string | null): Promise<DeltaAlert> {
        return this.log({ ...alert, sessionId });
    }

    /**
     * Register a pending trigger if there's no active trigger and a valid target session.
     */
    private async registerTrigger(alert: AlertInput): Promise<void> {
        const entry: DeltaAlert = {
            ...alert,
            id: `pending-${randomUUID()}`,
            timestamp: Date.now(),
            expiresAt: Date.now() + ALERT_TTL_MS,
            sessionId: alert.sessionId ?? null
        };

        if (this.triggerInFlight) {
            this.pendingTriggers.push(entry);
            loggerService.catDebug(LogCategory.SYSTEM, `Alert queued: trigger already in flight`);
            return;
        }

        const activeSessionId = uiStateService.activeSessionId;
        if (!activeSessionId) {
            loggerService.catDebug(LogCategory.SYSTEM, `Alert discarded: no active session`);
            return;
        }

        const activeSession = await contextService.getSession(activeSessionId);
        if (!activeSession || activeSession.status !== 'open') {
            loggerService.catDebug(LogCategory.SYSTEM, `Alert discarded: inactive session ${activeSessionId}`);
            return;
        }

        this.pendingTriggers.push(entry);
        loggerService.catInfo(LogCategory.SYSTEM, `Alert registered for post-inference trigger: ${alert.summary}`);
    }

    /**
     * Called by the INFERENCE_COMPLETED listener after inference finishes.
     * Returns the highest-priority pending alert, or null if none.
     */
    async onInferenceComplete(): Promise<DeltaAlert | null> {
        if (this.pendingTriggers.length === 0) {
            return null;
        }

        // Take the highest severity pending trigger
        const sorted = [...this.pendingTriggers].sort((a, b) => {
            const order: Record<AlertSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
            return order[a.severity] - order[b.severity];
        });
        const alert = sorted[0];

        // Remove from pending
        this.pendingTriggers = this.pendingTriggers.filter(a => a.id !== alert.id);

        // Mark trigger as in-flight
        this.triggerInFlight = true;

        return alert;
    }

    /**
     * Signal that the alert-triggered inference has completed.
     * Checks for more pending triggers.
     */
    async resolveTrigger(): Promise<void> {
        this.triggerInFlight = false;

        // Check if there are more pending triggers
        if (this.pendingTriggers.length > 0) {
            await this.onInferenceComplete();
        }
    }

    /**
     * Get active (non-expired) alerts.
     */
    getActive(): DeltaAlert[] {
        const now = Date.now();
        return this.alerts.filter(a => a.expiresAt > now);
    }

    /**
     * Clear expired alerts.
     */
    private clearExpired(): void {
        const now = Date.now();
        const before = this.alerts.length;
        this.alerts = this.alerts.filter(a => a.expiresAt > now);
        const cleared = before - this.alerts.length;
        if (cleared > 0) {
            loggerService.catDebug(LogCategory.SYSTEM, `Cleared ${cleared} expired alerts`);
        }
    }
}

export const alertTriggerService = new AlertTriggerService();
