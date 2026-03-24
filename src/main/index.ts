import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

// Kernel Services
import { contextService } from './services/contextService.js'
import { inferenceService, sendMessageAndHandleTools, getChatSession } from './services/inferenceService.js'
import { domainService } from './services/domainService.js'
import { settingsService } from './services/settingsService.js'
import { createToolExecutor } from './services/toolsService.js'
import { loggerService } from './services/loggerService.js'
import { agentService } from './services/agentService.js'
import { eventBusService, KernelEventType } from './services/eventBusService.js'

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Forward traces to renderer
  eventBusService.onKernelEvent(KernelEventType.TRACE_LOGGED, (trace) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('trace:logged', trace);
    }
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // IPC Handlers
  ipcMain.handle('context:create', async (_, type, metadata, name) => {
    return await contextService.createSession(type, metadata, name);
  });

  ipcMain.handle('context:list', async () => {
    return await contextService.listSessions(undefined, true);
  });

  ipcMain.handle('context:get', async (_, id) => {
    return await contextService.getSession(id, undefined, true);
  });

  ipcMain.handle('context:history', async (_, id) => {
    return await contextService.getHistory(id, undefined, true);
  });

  ipcMain.handle('context:delete', async (_, id) => {
    return await contextService.deleteSession(id, undefined, true);
  });

  ipcMain.handle('inference:send', async (event, sessionId, message, systemInstruction) => {
    const chat = await getChatSession(systemInstruction || '', sessionId);
    const toolExecutor = createToolExecutor(sessionId);
    
    try {
      const stream = sendMessageAndHandleTools(
        chat, 
        message, 
        toolExecutor, 
        systemInstruction, 
        sessionId
      );

      for await (const chunk of stream) {
        if (chunk.text) {
          event.sender.send('inference:chunk', chunk.text);
        }
        if (chunk.toolCalls) {
          // You might want to send tool call info to UI too
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

  ipcMain.handle('settings:get', async () => {
    return await settingsService.get();
  });

  ipcMain.handle('settings:update', async (_, settings) => {
    return await settingsService.update(settings);
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

  ipcMain.handle('agent:logs', async (_, agentId, limit, includeTraces) => {
    return await agentService.getExecutionLogs(agentId, limit, includeTraces);
  });

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Initialize Services
  await settingsService.initialize();
  await domainService.init('root', 'Root Domain');
  await domainService.bootstrapUserDomains('default-user');

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.signalzero.desktop')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
