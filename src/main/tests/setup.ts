import { vi } from 'vitest'

const mockElectron = {
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/signalzero-test'),
    getAppPath: vi.fn().mockReturnValue('/Users/klietus/workspace/LocalNode/SignalZero-Desktop'),
    isPackaged: false,
    commandLine: {
        appendSwitch: vi.fn()
    }
  },
  systemPreferences: {
    askForMediaAccess: vi.fn().mockResolvedValue(true)
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeAllListeners: vi.fn()
  },
  shell: {
    openExternal: vi.fn()
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(true),
    encryptString: vi.fn().mockImplementation((str) => Buffer.from(str)),
    decryptString: vi.fn().mockImplementation((buf) => buf.toString())
  },
  BrowserWindow: class { 
    loadURL = vi.fn();
    on = vi.fn();
    webContents = { 
        send: vi.fn(),
        setWindowOpenHandler: vi.fn()
    };
    isDestroyed = vi.fn().mockReturnValue(false);
  },
  Menu: {
    buildFromTemplate: vi.fn(),
    setApplicationMenu: vi.fn()
  },
  Tray: class {
    setToolTip = vi.fn();
    setContextMenu = vi.fn();
  },
  nativeImage: {
    createFromPath: vi.fn().mockReturnValue({ resize: vi.fn().mockReturnThis(), setTemplateImage: vi.fn() }),
    createEmpty: vi.fn()
  },
  desktopCapturer: {
    getSources: vi.fn().mockResolvedValue([])
  },
  dialog: {
      showSaveDialog: vi.fn(),
      showOpenDialog: vi.fn()
  }
};

vi.mock('electron', () => ({
  ...mockElectron,
  default: mockElectron
}))
