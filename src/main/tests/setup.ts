import { vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/signalzero-test'),
    isPackaged: false
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn()
  },
  shell: {
    openExternal: vi.fn()
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(true),
    encryptString: vi.fn().mockImplementation((str) => Buffer.from(str)),
    decryptString: vi.fn().mockImplementation((buf) => buf.toString())
  }
}))
