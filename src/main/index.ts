import { app, shell, BrowserWindow, ipcMain, Menu, Tray, nativeImage, desktopCapturer } from 'electron'

// Increase memory limit for the main process and worker threads
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=8192');

import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/cognitav.jpg?asset'

// Kernel Services
import { contextService } from './services/contextService.js'
import { processMessageAsync } from './services/inferenceService.js'
import { domainService } from './services/domainService.js'
import { settingsService } from './services/settingsService.js'
import { createToolExecutor } from './services/toolsService.js'
import { loggerService, LogCategory } from './services/loggerService.js'
import { agentService } from './services/agentService.js'
import { eventBusService } from './services/eventBusService.js'
import { KernelEventType } from './types.js'
import { systemPromptService } from './services/systemPromptService.js'
import { ACTIVATION_PROMPT } from './symbolic_system/activation_prompt.js'
import { projectService } from './services/projectService.js'
import { mcpPromptService } from './services/mcpPromptService.js'
import { traceService } from './services/traceService.js'
import { topologyService } from './services/topologyService.js'
import { monitoringService } from './services/monitoringService.js'
import { sqliteService } from './services/sqliteService.js'
import { mcpClientService } from './services/mcpClientService.js'
import { attachmentService } from './services/attachmentService.js'
import { agentRunner } from './services/agentRunner.js'
import { realtimeService } from './services/realtime/realtimeService.js'
import { llamaService, urgentLlamaService } from './services/llamaService.js'
import { uiStateService } from './services/uiStateService.js'

// --- IPC Batching Engine ---
const ipcBatchQueues = new Map<string, any>();
const ipcBatchTimers = new Map<string, NodeJS.Timeout>();

function broadcastBatched(channel: string, data: any, intervalMs: number = 100) {
  const batchKey = data?.type ? `${channel}:${data.type}` : channel;

  // Use array accumulation for monitoring deltas to prevent data loss
  if (channel === 'kernel-event' && data?.type === 'monitoring:delta-created') {
    const existing = ipcBatchQueues.get(batchKey) || [];
    if (Array.isArray(existing)) {
        existing.push(data.payload);
        ipcBatchQueues.set(batchKey, existing);
    }
  } else {
    // Default behavior for high-frequency streams: last-one-wins
    ipcBatchQueues.set(batchKey, data);
  }

  if (!ipcBatchTimers.has(batchKey)) {
    const timer = setInterval(() => {
      const batchedData = ipcBatchQueues.get(batchKey);
      if (batchedData) {
        if (Array.isArray(batchedData) && channel === 'kernel:event') {
            // Send as a special batched event type
            broadcast(channel, { type: 'monitoring:deltas-batched', data: batchedData });
        } else {
            broadcast(channel, batchedData);
        }
        ipcBatchQueues.delete(batchKey);
      }
    }, intervalMs);
    ipcBatchTimers.set(batchKey, timer);
  }
}
import fs from 'fs'
import { dialog } from 'electron'

let activeSystemPrompt = ACTIVATION_PROMPT;
let mainWindow: BrowserWindow | null = null;
let monitorWindow: BrowserWindow | null = null;
export let activeSessionId: string | null = null;

const updateActiveSession = (id: string | null) => {
  activeSessionId = id;
  uiStateService.setActiveSessionId(id);
};

export const broadcast = (channel: string, ...args: any[]) => {
  // --- Safe Serialization Layer ---
  const safeArgs = args.map(arg => {
    try {
      // If it's a simple primitive, return as is
      if (arg === null || typeof arg !== 'object') return arg;

      // Handle Error objects specifically (they don't serialize to JSON well)
      if (arg instanceof Error) {
        return {
          message: arg.message,
          stack: arg.stack,
          name: arg.name
        };
      }

      // Use a replacer to handle potential circular references
      const cache = new Set();
      const json = JSON.stringify(arg, (_key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (cache.has(value)) return '[Circular]';
          cache.add(value);
        }
        return value;
      });
      return JSON.parse(json);
    } catch (e) {
      return `[Unserializable Data: ${String(e)}]`;
    }
  });

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...safeArgs);
  }
  if (monitorWindow && !monitorWindow.isDestroyed()) {
    monitorWindow.webContents.send(channel, ...safeArgs);
  }
}
  ;

async function performRecovery() {
  try {
    loggerService.catInfo(LogCategory.SYSTEM, "Checking for interrupted contexts requiring recovery...");
    const contexts = await contextService.listSessions();
    const pendingContexts = contexts.filter(c => c.activeMessageId && c.status === 'open');

    for (const ctx of pendingContexts) {
      const history = await contextService.getUnfilteredHistory(ctx.id);
      const lastUserMsg = [...history].reverse().find(m => m.role === 'user');

      if (lastUserMsg) {
        loggerService.catInfo(LogCategory.SYSTEM, `Recovering context ${ctx.id}. Retrying message ${ctx.activeMessageId}`);
        const toolExecutor = createToolExecutor(ctx.id);
        processMessageAsync(ctx.id, lastUserMsg.content, toolExecutor, activeSystemPrompt, ctx.activeMessageId || undefined)
          .catch(err => loggerService.catError(LogCategory.SYSTEM, `Recovery failed for context ${ctx.id}`, { error: err.message }));
      } else {
        loggerService.catWarn(LogCategory.SYSTEM, `Context ${ctx.id} has activeMessageId but no user prompt in history. Clearing stale lock.`);
        await contextService.setActiveMessage(ctx.id, null);
      }
    }

    // NEW: Clean up malformed symbols (null or empty IDs)
    loggerService.catInfo(LogCategory.SYSTEM, "Cleaning up malformed symbols...");
    const result = sqliteService.run(`DELETE FROM symbols WHERE id IS NULL OR id = '' OR id = 'undefined'`);
    if (result.changes > 0) {
      loggerService.catInfo(LogCategory.SYSTEM, `Purged ${result.changes} malformed symbols from store.`);
    }

  } catch (error: any) {
    loggerService.catError(LogCategory.SYSTEM, "Recovery process failed", { error: error.message });
  }
}

function createMonitorWindow(): void {
  if (monitorWindow && !monitorWindow.isDestroyed()) {
    monitorWindow.focus();
    return;
  }

  monitorWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    title: 'Signal Zero Monitor',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  });

  monitorWindow.on('ready-to-show', () => {
    monitorWindow?.show();
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    monitorWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '?view=world-monitor')
  } else {
    monitorWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { view: 'world-monitor' } })
  }
}

function setupNativeMenu() {
  const template: any[] = [
    {
      label: 'Signal Zero',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings...',
          accelerator: 'CmdOrCtrl+,',
          click: () => broadcast('navigate', 'settings')
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Kernel Chat',
          accelerator: 'CmdOrCtrl+1',
          click: () => broadcast('navigate', 'chat')
        },
        {
          label: 'Symbol Domains',
          accelerator: 'CmdOrCtrl+2',
          click: () => broadcast('navigate', 'store')
        },
        {
          label: 'Symbol Forge',
          accelerator: 'CmdOrCtrl+3',
          click: () => broadcast('navigate', 'dev')
        },
        {
          label: 'Project Config',
          accelerator: 'CmdOrCtrl+4',
          click: () => broadcast('navigate', 'project')
        },
        {
          label: 'System Logs',
          accelerator: 'CmdOrCtrl+5',
          click: () => broadcast('navigate', 'logs')
        },
        { type: 'separator' },
        {
          label: 'Launch Monitor',
          accelerator: 'CmdOrCtrl+M',
          click: () => createMonitorWindow()
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
        { type: 'separator' },
        { role: 'window' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

let tray: Tray | null = null;

async function captureScreenshot() {
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
    const primarySource = sources[0];
    if (!primarySource) throw new Error("No screen source found");

    const png = primarySource.thumbnail.toPNG();
    const tempPath = join(app.getPath('temp'), `screenshot-${Date.now()}.png`);
    fs.writeFileSync(tempPath, png);

    const attachment = await attachmentService.processAndSave(tempPath, `screenshot-${new Date().toISOString()}.png`, 'image/png');

    // Notify renderer that a screenshot was taken and is ready to be attached
    broadcast('screenshot:captured', {
      id: attachment.id,
      filename: attachment.filename,
      type: attachment.mime_type,
      thumbnail: `data:image/png;base64,${attachment.image_base64}`
    });

    // Cleanup temp file
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

    return {
      id: attachment.id,
      filename: attachment.filename,
      type: attachment.mime_type,
      thumbnail: `data:image/png;base64,${attachment.image_base64}`
    };
  } catch (error: any) {
    loggerService.catError(LogCategory.SYSTEM, "Failed to capture screenshot", { error: error.message });
    return null;
  }
}

function setupTray() {
  if (tray) return;

  try {
    const iconPath = is.dev
      ? join(app.getAppPath(), 'resources/cognitav.jpg')
      : join(process.resourcesPath, 'cognitav.jpg');

    let trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });

    // On macOS, make it a template image so it works in light/dark mode
    if (process.platform === 'darwin') {
      trayIcon.setTemplateImage(true);
    }

    tray = new Tray(trayIcon);
  } catch (err) {
    // Fallback to a placeholder if icon loading fails
    const emptyIcon = nativeImage.createEmpty();
    tray = new Tray(emptyIcon);
  }

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Signal Zero', enabled: false },
    { type: 'separator' },
    { label: 'Capture Screenshot', click: () => captureScreenshot() },
    { label: 'Open Monitor', click: () => createMonitorWindow() },
    { type: 'separator' },
    { label: 'Show Main Window', click: () => mainWindow?.show() },
    { label: 'Quit', click: () => app.quit() }
  ]);

  tray.setToolTip('Signal Zero');
  tray.setContextMenu(contextMenu);
}

function createWindow(): void {
  setupTray();
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 1000,
    show: false,
    autoHideMenuBar: false,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Global Event Forwarding
  Object.values(KernelEventType).forEach(type => {
    eventBusService.onKernelEvent(type, (raw) => {
      // Skip ultra-high frequency events from the main monitor stream
      if (type !== KernelEventType.INFERENCE_CHUNK) {
        if (type === 'monitoring:delta-created' as any) {
            broadcastBatched('kernel:event', { type, payload: raw }, 100);
        } else {
            broadcast('kernel:event', { type, data: raw });
        }
      }

      // Legacy/Specific forwards
      if (type === KernelEventType.TRACE_LOGGED) broadcast('trace:logged', raw);
      if (type === KernelEventType.INFERENCE_CHUNK) {
        const chunk = raw as { sessionId: string; text: string };
        broadcastBatched(`inference:chunk:${chunk.sessionId}`, chunk.text, 50);
        broadcastBatched('inference:chunk', { sessionId: chunk.sessionId, text: chunk.text }, 50);
      }
      if (type === KernelEventType.INFERENCE_COMPLETED) {
        const completed = raw as { sessionId: string };
        broadcast(`inference:completed:${completed.sessionId}`, raw);
        broadcast('inference:completed', { sessionId: completed.sessionId });
      }
      if (type === KernelEventType.INFERENCE_ERROR) {
        const error = raw as { error: string; sessionId: string };
        broadcast(`inference:error:${error.sessionId}`, error.error);
      }
    });
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    if (mainWindow) mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    if (mainWindow) mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  // --- KERNEL BOOT DIAGNOSTICS ---
  try {
    const diagnosticInfo = {
      version: app.getVersion(),
      isDev: is.dev,
      arch: process.arch,
      platform: process.platform,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      userData: app.getPath('userData'),
      execPath: process.execPath
    };
    loggerService.catInfo(LogCategory.SYSTEM, "Kernel Diagnostic Header", diagnosticInfo);

    const checkPaths = [
      join(app.getAppPath(), 'node_modules/@lancedb/lancedb'),
      join(app.getAppPath(), 'node_modules/apache-arrow'),
      join(app.getAppPath(), 'node_modules/better-sqlite3')
    ];

    for (const p of checkPaths) {
      const exists = fs.existsSync(p);
      loggerService.catInfo(LogCategory.SYSTEM, `Path Check: ${p} - Exists: ${exists}`);
      if (exists && fs.lstatSync(p).isDirectory()) {
        const contents = fs.readdirSync(p).slice(0, 5);
        loggerService.catDebug(LogCategory.SYSTEM, `Directory Content (${p}): ${contents.join(', ')}`);
      }
    }
  } catch (err: any) {
    loggerService.catError(LogCategory.SYSTEM, "Diagnostics failed to run fully", { error: err.message });
  }
  // --- END DIAGNOSTICS ---

  setupNativeMenu();
  await settingsService.initialize();

  try {
    activeSystemPrompt = await systemPromptService.loadPrompt(ACTIVATION_PROMPT);
    loggerService.catInfo(LogCategory.SYSTEM, "System Prompt loaded");
  } catch (error) {
    loggerService.catError(LogCategory.SYSTEM, "Failed to load system prompt", { error });
  }

  await domainService.init('root', 'Root Domain');
  await domainService.init('user', 'User Domain');
  await domainService.init('state', 'State Domain');

  await monitoringService.initialize();

  // Ensure Vector Index is populated
  try {
    await domainService.ensureVectorIndex();
  } catch (error) {
    loggerService.catError(LogCategory.KERNEL, "Failed to ensure vector index", { error });
  }

  // Background sync: iteratively clean up desyncs every 5 minutes
  setInterval(async () => {
    try {
      await domainService.ensureVectorIndex();
    } catch (error) {
      loggerService.catError(LogCategory.KERNEL, "Background vector index sync failed", { error });
    }
  }, 5 * 60 * 1000);

  // Background topology analysis: run hygiene every 15 minutes
  setInterval(async () => {
    try {
      loggerService.catInfo(LogCategory.SYSTEM, "Starting background graph hygiene run...");
      await topologyService.analyze();
    } catch (error: any) {
      loggerService.catError(LogCategory.SYSTEM, "Background graph hygiene failed", { error: error.message });
    }
  }, 15 * 60 * 1000);
  electronApp.setAppUserModelId('com.signalzero.desktop')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()
  uiStateService.registerBroadcastHandler(broadcast);
  await performRecovery();

  // Initialize background runners
  agentRunner;

  // Initialize Llama Sidecars
  Promise.all([
    llamaService.initialize(),
    urgentLlamaService.initialize()
  ]).catch(err => {
    loggerService.catError(LogCategory.SYSTEM, "Failed to initialize Llama Sidecars", { error: err.message });
  });

  // Initialize Real-time services
  await realtimeService.initialize();

  // Listen for scene updates and broadcast to all windows
  realtimeService.onUpdate((update) => {
    broadcastBatched('realtime:scene-update', update, 200); // 5Hz UI update is plenty for perception
  });

  // Listen for status changes (high-priority, non-batched)
  realtimeService.onStatusChange((update) => {
    broadcast('realtime:status-change', update);
  });

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  llamaService.stop();
  urgentLlamaService.stop();
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  llamaService.stop();
  urgentLlamaService.stop();
});

// IPC Handlers
ipcMain.handle('realtime:toggle-stream', async (_, type) => {
  return await realtimeService.toggleStream(type);
});

ipcMain.handle('realtime:set-voice-enabled', async (_, enabled) => {
  return await realtimeService.setVoiceEnabled(enabled);
});

ipcMain.handle('realtime:cancel-speech', async () => {
  return await realtimeService.cancelSpeech();
});

ipcMain.handle('context:create', async (_, type, metadata, name) => {
  return await contextService.createSession(type, metadata, name);
});

ipcMain.handle('context:list', async () => {
  return await contextService.listSessions();
});

ipcMain.handle('context:get', async (_, id) => {
  return await contextService.getSession(id);
});

ipcMain.handle('context:history', async (_, id) => {
  updateActiveSession(id);
  return await contextService.getHistory(id);
});

ipcMain.handle('context:set-active', async (_, id) => {
  updateActiveSession(id);
  loggerService.catInfo(LogCategory.SYSTEM, `Active session set to: ${id}`);
  return { success: true };
});

ipcMain.handle('context:delete', async (_, id) => {
  return await contextService.deleteSession(id);
});

ipcMain.handle('system:get-recent-logs', async (_, limit) => {
  return await loggerService.getRecentLogs(limit);
});

ipcMain.handle('trace:list', async (_, sessionId) => {
  return await traceService.getBySession(sessionId);
});

ipcMain.handle('inference:send', async (_, sessionId, message, systemInstruction, metadata?: Record<string, any>) => {
  updateActiveSession(sessionId);

  // Interrupt ongoing speech if user sends new message
  realtimeService.cancelSpeech();

  const toolExecutor = createToolExecutor(sessionId);
  const finalSystemInstruction = systemInstruction || activeSystemPrompt;

  // Run in background, do not await the full stream
  processMessageAsync(sessionId, message, toolExecutor, finalSystemInstruction, undefined, metadata);

  // Return immediately to keep UI responsive
  return { success: true };
});

// Listener for voice output completion (event-driven)
eventBusService.onKernelEvent(KernelEventType.INFERENCE_COMPLETED, (raw) => {
  const data = raw as { fullText: string };
  realtimeService.speak(data.fullText, null).catch(err => {
    loggerService.catError(LogCategory.SYSTEM, "Event-driven Voice output failed", { error: err.message });
  });
});

ipcMain.handle('domain:list', async () => {
  return await domainService.listDomains();
});

ipcMain.handle('domain:metadata', async () => {
  return await domainService.getMetadata();
});

ipcMain.handle('domain:get', async (_, id) => {
  return await domainService.get(id);
});

ipcMain.handle('domain:upsert', async (_, id, data) => {
  return await domainService.upsertDomain(id, data);
});

ipcMain.handle('domain:update', async (_, id, data) => {
  return await domainService.updateDomain(id, data);
});

ipcMain.handle('domain:search', async (_, query, limit, options) => {
  return await domainService.search(query, limit, options);
});

ipcMain.handle('domain:upsert-symbol', async (_, domainId, symbol) => {
  return await domainService.addSymbol(domainId, symbol);
});

ipcMain.handle('domain:get-symbols', async (_, domainId) => {
  return await domainService.getSymbols(domainId);
});

ipcMain.handle('domain:get-symbol', async (_, id) => {
  return await domainService.findById(id);
});

ipcMain.handle('domain:all-symbols', async () => {
  return await domainService.getAllSymbols();
});

ipcMain.handle('domain:delete-symbol', async (_, domainId, symbolId) => {
  return await domainService.deleteSymbol(domainId, symbolId);
});

ipcMain.handle('domain:delete', async (_, domainId) => {
  return await domainService.deleteDomain(domainId);
});

ipcMain.handle('domain:get-symbol-count', async () => {
  return await domainService.getSymbolCount();
});

ipcMain.handle('domain:get-domain-count', async () => {
  return await domainService.getDomainCount();
});

ipcMain.handle('domain:get-link-count', async () => {
  return await domainService.getLinkCount();
});

ipcMain.handle('context:update-session', async (_, session) => {
  return await contextService.updateSession(session);
});

ipcMain.handle('settings:get', async () => {
  return await settingsService.get();
});

ipcMain.handle('settings:update', async (_, settings) => {
  loggerService.catInfo(LogCategory.SYSTEM, "IPC Handle: settings:update", {
    hasInference: !!settings.inference,
    voiceProfilesCount: settings.inference?.voiceProfiles ? Object.keys(settings.inference.voiceProfiles).length : 0
  });
  const updated = await settingsService.update(settings);
  await monitoringService.refreshIntervals();
  
  // Notify system components of settings changes
  eventBusService.emitKernelEvent(KernelEventType.SETTINGS_UPDATED, { settings } as const);
  
  return updated;
});

ipcMain.handle('monitoring:poll-source', async (_, sourceId) => {
  const settings = await settingsService.getMonitoringSettings();
  const source = settings.sources.find(s => s.id === sourceId);
  if (source) {
    // We trigger it asynchronously to not block UI
    monitoringService.triggerPoll(sourceId);
    return { success: true };
  }
  return { success: false, error: 'Source not found' };
});

ipcMain.handle('monitoring:list-deltas', async (_, filter?: { sourceId?: string, period?: string, limit?: number }) => {
  const limit = filter?.limit || 100;
  let sql = `SELECT * FROM monitoring_deltas`;
  const params: any[] = [];
  const whereParts: string[] = [];

  if (filter?.sourceId) {
    whereParts.push(`source_id = ?`);
    params.push(filter.sourceId);
  }
  if (filter?.period) {
    whereParts.push(`period = ?`);
    params.push(filter.period);
  }

  if (whereParts.length > 0) {
    sql += ` WHERE ` + whereParts.join(' AND ');
  }

  sql += ` ORDER BY timestamp DESC LIMIT ?`;
  params.push(limit);

  return sqliteService.all(sql, params);
});

ipcMain.handle('monitoring:regenerate-delta', async (_, deltaId) => {
  return await monitoringService.regenerateDelta(deltaId);
});

ipcMain.handle('system:validate-mcp', async (_, endpoint, token) => {
  return await mcpClientService.validateConfig(endpoint, token);
});

ipcMain.handle('system:run-hygiene', async (_, strategy) => {
  return await topologyService.analyze(strategy);
});

ipcMain.handle('system:is-initialized', () => {
  return settingsService.isInitialized();
});

ipcMain.handle('system:show-emoji-picker', () => {
  if (process.platform === 'darwin') {
    app.showEmojiPanel();
  }
});

ipcMain.handle('agent:list', async () => {
  return await agentService.listAgents();
});

ipcMain.handle('agent:upsert', async (_, id, prompt, enabled, schedule, subscriptions) => {
  return await agentService.upsertAgent(id, prompt, enabled, schedule, subscriptions);
});

ipcMain.handle('agent:delete', async (_, id) => {
  return await agentService.deleteAgent(id);
});

ipcMain.handle('agent:logs', async (_, agentId, limit) => {
  return await agentService.getExecutionLogs(agentId, limit);
});

ipcMain.handle('project:export', async (_, meta) => {
  const sysPrompt = await systemPromptService.loadPrompt(ACTIVATION_PROMPT);
  const mcpPrompt = await mcpPromptService.loadPrompt("");
  const buffer = await projectService.export(meta, sysPrompt, mcpPrompt);

  const { filePath } = await dialog.showSaveDialog({
    title: 'Export Project',
    defaultPath: `${meta.name || 'project'}.szproject`,
    filters: [{ name: 'SignalZero Project', extensions: ['szproject'] }]
  });

  if (filePath) {
    fs.writeFileSync(filePath, Buffer.from(buffer));
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle('project:import', async () => {
  const { filePaths } = await dialog.showOpenDialog({
    title: 'Import Project',
    filters: [{ name: 'SignalZero Project', extensions: ['szproject'] }],
    properties: ['openFile']
  });

  if (filePaths && filePaths.length > 0) {
    const buffer = fs.readFileSync(filePaths[0]);
    return await projectService.import(buffer);
  }
  return { success: false };
});

ipcMain.handle('project:import-sample', async () => {
  const samplePath = is.dev
    ? join(app.getAppPath(), '../../signalzero_sample.szproject')
    : join(process.resourcesPath, 'signalzero_sample.szproject');

  if (fs.existsSync(samplePath)) {
    const buffer = fs.readFileSync(samplePath);
    return await projectService.import(buffer);
  }
  throw new Error("Sample project not found at: " + samplePath);
});

ipcMain.handle('system-prompt:get', async () => {
  return await systemPromptService.loadPrompt(ACTIVATION_PROMPT);
});

ipcMain.handle('system-prompt:set', async (_, prompt) => {
  await systemPromptService.setPrompt(prompt);
  activeSystemPrompt = prompt;
  return { success: true };
});

ipcMain.handle('mcp-prompt:get', async () => {
  return await mcpPromptService.loadPrompt("");
});

ipcMain.handle('mcp-prompt:set', async (_, prompt) => {
  return await mcpPromptService.setPrompt(prompt);
});
ipcMain.handle('system:process-attachment', async (_, file: { name: string, path: string, type: string }) => {
  return await attachmentService.processAndSave(file.path, file.name, file.type);
});

ipcMain.handle('attachment:process-base64', async (_, { data, name, type }) => {
  const attachment = await attachmentService.processAndSaveBase64(data, name, type);
  return {
    id: attachment.id,
    filename: attachment.filename,
    type: attachment.mime_type,
    thumbnail: `data:${attachment.mime_type};base64,${attachment.image_base64}`
  };
});

ipcMain.handle('system:capture-screenshot', async () => {
  const attachment = await captureScreenshot();
  if (!attachment) return null;
  return {
    id: attachment.id,
    filename: attachment.filename,
    type: attachment.type,
    thumbnail: attachment.thumbnail
  };
});

ipcMain.handle('window:open-monitor', async () => {
  createMonitorWindow();
});

ipcMain.handle('realtime:get-state', () => {
  return realtimeService.getState();
});

ipcMain.handle('realtime:start-stream', async (_, type: 'camera' | 'screen' | 'audio') => {
  return await realtimeService.startStream(type);
});

ipcMain.handle('realtime:stop-stream', async (_, type: 'camera' | 'screen' | 'audio') => {
  return await realtimeService.stopStream(type);
});

ipcMain.handle('voice:toggle-mode', async (_, enabled: boolean) => {
  if (enabled) {
    await realtimeService.startStream('audio');
  } else {
    await realtimeService.stopStream('audio');
  }
});
