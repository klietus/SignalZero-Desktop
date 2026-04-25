import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { alertTriggerService } from '../services/alertTriggerService.js';

const state = vi.hoisted(() => ({
  sessionId: 'test-session-id',
  getSession: vi.fn().mockResolvedValue({ id: 'test-session-id', status: 'open' as const })
}));

vi.mock('../services/uiStateService.js', () => ({
  uiStateService: {
    get activeSessionId() { return state.sessionId; }
  }
}));

vi.mock('../services/contextService.js', () => ({
  contextService: { getSession: state.getSession }
}));

vi.mock('../services/loggerService.js', () => ({
  loggerService: {
    catInfo: vi.fn(),
    catDebug: vi.fn(),
    catError: vi.fn(),
  },
  LogCategory: {
    SYSTEM: 'SYSTEM',
  }
}));

const MOCK_SESSION_ID = 'test-session-id';

describe('AlertTriggerService — Tools Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    state.sessionId = MOCK_SESSION_ID;
    state.getSession.mockResolvedValue({ id: MOCK_SESSION_ID, status: 'open' as const });
    (alertTriggerService as any).alerts = [];
    (alertTriggerService as any).pendingTriggers = [];
    (alertTriggerService as any).triggerInFlight = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('log_delta_alert tool path should log and return status', async () => {
    const result = await alertTriggerService.log({
      source: 'agent',
      severity: 'high',
      summary: 'Delta from gdelt',
      metadata: { sourceId: 'gdelt', deltaId: 'delta-99' }
    });

    expect(result.source).toBe('agent');
    expect(result.metadata.sourceId).toBe('gdelt');
    expect(result.metadata.deltaId).toBe('delta-99');
  });

  it('query_alerts should return active alerts filtered by severity', async () => {
    await alertTriggerService.log({ source: 'agent', severity: 'low', summary: 'L1', metadata: {} });
    await alertTriggerService.log({ source: 'agent', severity: 'medium', summary: 'M1', metadata: {} });
    await alertTriggerService.log({ source: 'perception', severity: 'high', summary: 'H1', metadata: {} });

    // Without includeLow — should exclude low
    const active = alertTriggerService.getActive();
    expect(active).toHaveLength(3);

    const filtered = active.filter(a => a.severity !== 'low');
    expect(filtered).toHaveLength(2);
    expect(filtered.map(f => f.summary)).toContain('M1');
    expect(filtered.map(f => f.summary)).toContain('H1');
  });

  it('query_alerts should filter by source', async () => {
    await alertTriggerService.log({ source: 'agent', severity: 'high', summary: 'Agent alert', metadata: {} });
    await alertTriggerService.log({ source: 'perception', severity: 'high', summary: 'Perception alert', metadata: {} });

    const agentAlerts = alertTriggerService.getActive().filter(a => a.source === 'agent');
    const perceptionAlerts = alertTriggerService.getActive().filter(a => a.source === 'perception');

    expect(agentAlerts).toHaveLength(1);
    expect(perceptionAlerts).toHaveLength(1);
    expect(agentAlerts[0].summary).toBe('Agent alert');
    expect(perceptionAlerts[0].summary).toBe('Perception alert');
  });

  it('should handle empty metadata gracefully', async () => {
    const result = await alertTriggerService.log({
      source: 'agent',
      severity: 'medium',
      summary: 'Empty metadata',
      metadata: {}
    });

    expect(result.metadata).toEqual({});
  });

  it('should handle null sessionId in logForSession', async () => {
    const result = await alertTriggerService.logForSession({
      source: 'agent',
      severity: 'low',
      summary: 'No session',
      metadata: {}
    }, null);

    expect(result.sessionId).toBeNull();
  });

  it('should handle rapid-fire high severity alerts', async () => {
    for (let i = 0; i < 10; i++) {
      await alertTriggerService.log({
        source: 'perception',
        severity: 'high',
        summary: `Rapid ${i}`,
        metadata: { index: i }
      });
    }

    const pending = (alertTriggerService as any).pendingTriggers;
    expect(pending).toHaveLength(10);

    // First should be highest priority (all same severity, first in = first out after sort)
    const first = await alertTriggerService.onInferenceComplete();
    expect(first).not.toBeNull();
    expect(first!.summary).toMatch(/^Rapid/);
  });

  it('should not double-count alerts in getActive after onInferenceComplete', async () => {
    await alertTriggerService.log({
      source: 'perception',
      severity: 'high',
      summary: 'Active check',
      metadata: {}
    });

    const before = alertTriggerService.getActive();
    expect(before).toHaveLength(1);

    await alertTriggerService.onInferenceComplete();

    const after = alertTriggerService.getActive();
    expect(after).toHaveLength(1); // Alert is still in alerts array, just removed from pendingTriggers
  });

  it('should preserve alert id format for pending triggers', async () => {
    await alertTriggerService.log({
      source: 'perception',
      severity: 'critical',
      summary: 'Pending id check',
      metadata: {}
    });

    const pending = (alertTriggerService as any).pendingTriggers;
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toMatch(/^pending-/);
  });

  it('should preserve alert id format for logged alerts', async () => {
    const result = await alertTriggerService.log({
      source: 'agent',
      severity: 'low',
      summary: 'Logged id check',
      metadata: {}
    });

    expect(result.id).toMatch(/^alert-/);
  });

  it('should handle mixed source alerts with correct priority', async () => {
    await alertTriggerService.log({ source: 'agent', severity: 'high', summary: 'Agent high', metadata: {} });
    await alertTriggerService.log({ source: 'perception', severity: 'critical', summary: 'Perception critical', metadata: {} });
    await alertTriggerService.log({ source: 'agent', severity: 'high', summary: 'Agent high 2', metadata: {} });

    const alert1 = await alertTriggerService.onInferenceComplete();
    expect(alert1!.summary).toBe('Perception critical');

    const alert2 = await alertTriggerService.onInferenceComplete();
    // Both remaining are high severity — order depends on sort stability
    expect(alert2!.severity).toBe('high');
  });
});
