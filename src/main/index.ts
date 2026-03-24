import { app, shell, BrowserWindow, ipcMain, Menu } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/cognitav.jpg?asset'

// Kernel Services
import { contextService } from './services/contextService.js'
import { sendMessageAndHandleTools, getChatSession, primeSymbolicContext, processMessageAsync } from './services/inferenceService.js'
import { domainService } from './services/domainService.js'
import { settingsService } from './services/settingsService.js'
import { createToolExecutor } from './services/toolsService.js'
import { loggerService, LogCategory } from './services/loggerService.js'
import { agentService } from './services/agentService.js'
import { eventBusService, KernelEventType } from './services/eventBusService.js'
import { systemPromptService } from './services/systemPromptService.js'
import { ACTIVATION_PROMPT } from './symbolic_system/activation_prompt.js'
import { projectService } from './services/projectService.js'
import { mcpPromptService } from './services/mcpPromptService.js'
import fs from 'fs'
import { dialog } from 'electron'

let activeSystemPrompt = ACTIVATION_PROMPT;
let mainWindow: BrowserWindow | null = null;
let monitorWindow: BrowserWindow | null = null;

const broadcast = (channel: string, ...args: any[]) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, ...args);
    }
    if (monitorWindow && !monitorWindow.isDestroyed()) {
        monitorWindow.webContents.send(channel, ...args);
    }
};

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
      title: 'SignalZero Monitor',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false
      }
  });

  monitorWindow.on('ready-to-show', () => {
      monitorWindow?.show();
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      monitorWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?view=monitor`)
  } else {
      monitorWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { view: 'monitor' } })
  }
}

function setupNativeMenu() {
    const template: any[] = [
        {
            label: 'SignalZero',
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

function createWindow(): void {
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
      eventBusService.onKernelEvent(type, (data) => {
          broadcast('kernel:event', { type, data });
          
          // Legacy/Specific forwards
          if (type === KernelEventType.TRACE_LOGGED) broadcast('trace:logged', data);
          if (type === KernelEventType.INFERENCE_CHUNK) {
              broadcast(`inference:chunk:${data.sessionId}`, data.text);
              broadcast('inference:chunk', data.text);
          }
          if (type === KernelEventType.INFERENCE_COMPLETED) {
              broadcast(`inference:completed:${data.sessionId}`);
              broadcast('inference:completed');
          }
          if (type === KernelEventType.INFERENCE_ERROR) {
              broadcast(`inference:error:${data.sessionId}`, data.error);
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
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
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

  electronApp.setAppUserModelId('com.signalzero.desktop')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()
  await performRecovery();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// IPC Handlers
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
  return await contextService.getHistory(id);
});

ipcMain.handle('context:delete', async (_, id) => {
  return await contextService.deleteSession(id);
});

ipcMain.handle('inference:send', async (event, sessionId, message, systemInstruction) => {
  try {
    const { traceNeeded } = await primeSymbolicContext(message, sessionId);
    const session = await contextService.getSession(sessionId);
    if (session) {
        await contextService.updateSession({
            ...session,
            metadata: { ...session.metadata, trace_needed: traceNeeded }
        });
    }

    const chat = await getChatSession(systemInstruction || activeSystemPrompt, sessionId);
    const toolExecutor = createToolExecutor(sessionId);
  
    const stream = sendMessageAndHandleTools(chat, message, toolExecutor, systemInstruction, sessionId);

    for await (const chunk of stream) {
      if (chunk.text) {
        event.sender.send('inference:chunk', chunk.text);
      }
    }
    
    event.sender.send('inference:completed');
    return { success: true };
  } catch (error: any) {
    loggerService.error("IPC Inference Error", { error: error.message });
    throw error;
  }
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

ipcMain.handle('domain:get-symbol-count', async () => {
  return await domainService.getSymbolCount();
});

ipcMain.handle('domain:get-domain-count', async () => {
  return await domainService.getDomainCount();
});

ipcMain.handle('context:update-session', async (_, session) => {
  return await contextService.updateSession(session);
});

ipcMain.handle('settings:get', async () => {
  return await settingsService.get();
});

ipcMain.handle('settings:update', async (_, settings) => {
  return await settingsService.update(settings);
});

ipcMain.handle('settings:is-initialized', () => {
  return settingsService.isInitialized();
});

ipcMain.handle('agent:list', async () => {
  return await agentService.listAgents();
});

ipcMain.handle('agent:upsert', async (_, id, prompt, enabled, schedule) => {
  return await agentService.upsertAgent(id, prompt, enabled, schedule);
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
      const result = await projectService.import(buffer);
      if (result.systemPrompt) {
          await systemPromptService.setPrompt(result.systemPrompt);
          activeSystemPrompt = result.systemPrompt;
      }
      if (result.mcpPrompt) await mcpPromptService.setPrompt(result.mcpPrompt);
      return result.stats;
  }
  return null;
});

ipcMain.handle('project:import-sample', async () => {
  const workspaceRoot = join(app.getAppPath(), is.dev ? '../..' : '../../..');
  const samplePath = join(workspaceRoot, 'signalzero_sample.szproject');
  
  if (fs.existsSync(samplePath)) {
      const buffer = fs.readFileSync(samplePath);
      const result = await projectService.import(buffer);
      if (result.systemPrompt) {
          await systemPromptService.setPrompt(result.systemPrompt);
          activeSystemPrompt = result.systemPrompt;
      }
      if (result.mcpPrompt) await mcpPromptService.setPrompt(result.mcpPrompt);
      return result.stats;
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

ipcMain.handle('window:open-monitor', async () => {
  createMonitorWindow();
});
