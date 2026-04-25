import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createToolExecutor } from '../services/toolsService.js';
import { STATIC_PRIMARY_TOOLS } from '../services/toolsService.js';

vi.mock('../services/alertTriggerService.js', () => ({
  alertTriggerService: {
    log: vi.fn().mockImplementation(async (alert) => ({
      id: `alert-mock-${Date.now()}`,
      timestamp: Date.now(),
      expiresAt: Date.now() + 30 * 60 * 1000,
      ...alert
    })),
    getActive: vi.fn().mockReturnValue([])
  }
}));

vi.mock('../services/uiStateService.js', () => ({
  uiStateService: { activeSessionId: 'test-session' }
}));

vi.mock('../services/contextService.js', () => ({
  contextService: { getSession: vi.fn().mockResolvedValue({ id: 'test-session', status: 'open' as const }) }
}));

vi.mock('../services/loggerService.js', () => ({
  loggerService: {
    catInfo: vi.fn(),
    catDebug: vi.fn(),
    catError: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  LogCategory: { SYSTEM: 'SYSTEM' }
}));

vi.mock('../services/systemPromptService.js', () => ({
  systemPromptService: { loadPrompt: vi.fn().mockResolvedValue('prompt') }
}));

vi.mock('../services/settingsService.js', () => ({
  settingsService: { getMonitoringSettings: vi.fn().mockResolvedValue({ enabled: true }) }
}));

const { alertTriggerService } = await import('../services/alertTriggerService.js');

describe('ToolsService — Alert Tool Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (alertTriggerService.getActive as any).mockReturnValue([]);
  });

  it('should expose log_delta_alert in STATIC_PRIMARY_TOOLS', () => {
    const tool = STATIC_PRIMARY_TOOLS.find(t => (t as any).function.name === 'log_delta_alert');
    expect(tool).toBeDefined();
    expect((tool as any).function.name).toBe('log_delta_alert');
    expect((tool as any).function.parameters.properties.severity.enum).toEqual(['low', 'medium', 'high', 'critical']);
  });

  it('should expose query_alerts in STATIC_PRIMARY_TOOLS', () => {
    const tool = STATIC_PRIMARY_TOOLS.find(t => (t as any).function.name === 'query_alerts');
    expect(tool).toBeDefined();
    expect((tool as any).function.name).toBe('query_alerts');
    expect((tool as any).function.parameters.properties.includeLow).toBeDefined();
    expect((tool as any).function.parameters.properties.source).toBeDefined();
  });

  it('log_delta_alert tool should call alertTriggerService.log', async () => {
    const executor = createToolExecutor('test-session');
    const result = await executor('log_delta_alert', {
      sourceId: 'gdelt',
      deltaId: 'delta-123',
      severity: 'high',
      summary: 'Test delta alert'
    });

    expect(result.status).toBe('logged');
    expect(result.alertSeverity).toBe('high');
    expect(alertTriggerService.log).toHaveBeenCalledWith({
      source: 'agent',
      severity: 'high',
      summary: 'Test delta alert',
      metadata: { sourceId: 'gdelt', deltaId: 'delta-123' }
    });
  });

  it('query_alerts tool should return active alerts', async () => {
    (alertTriggerService.getActive as any).mockReturnValue([
      { id: 'a1', severity: 'high', source: 'agent', summary: 'Alert 1', sessionId: null, metadata: {}, timestamp: 0, expiresAt: 999999999 },
      { id: 'a2', severity: 'low', source: 'perception', summary: 'Alert 2', sessionId: null, metadata: {}, timestamp: 0, expiresAt: 999999999 }
    ]);

    const executor = createToolExecutor('test-session');
    const result = await executor('query_alerts', { includeLow: false });

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].severity).toBe('high');
  });

  it('query_alerts tool should filter by source when provided', async () => {
    (alertTriggerService.getActive as any).mockReturnValue([
      { id: 'a1', severity: 'high', source: 'agent', summary: 'Agent alert', sessionId: null, metadata: {}, timestamp: 0, expiresAt: 999999999 },
      { id: 'a2', severity: 'high', source: 'perception', summary: 'Perception alert', sessionId: null, metadata: {}, timestamp: 0, expiresAt: 999999999 }
    ]);

    const executor = createToolExecutor('test-session');
    const result = await executor('query_alerts', { includeLow: true, source: 'agent' });

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].source).toBe('agent');
  });

  it('log_delta_alert tool should accept all severity levels', async () => {
    const executor = createToolExecutor('test-session');

    for (const severity of ['low', 'medium', 'high', 'critical'] as const) {
      await executor('log_delta_alert', {
        sourceId: 'test',
        deltaId: `delta-${severity}`,
        severity,
        summary: `Severity ${severity}`
      });

      expect(alertTriggerService.log).toHaveBeenLastCalledWith({
        source: 'agent',
        severity,
        summary: `Severity ${severity}`,
        metadata: { sourceId: 'test', deltaId: `delta-${severity}` }
      });
    }
  });
});
