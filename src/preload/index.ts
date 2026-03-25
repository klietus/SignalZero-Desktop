import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  // Context Management
  createContext: (type: string, metadata?: any, name?: string) => 
    ipcRenderer.invoke('context:create', type, metadata, name),
  listContexts: () => ipcRenderer.invoke('context:list'),
  getContext: (id: string) => ipcRenderer.invoke('context:get', id),
  getHistory: (id: string) => ipcRenderer.invoke('context:history', id),
  deleteContext: (id: string) => ipcRenderer.invoke('context:delete', id),
  
  // Inference
  sendMessage: (sessionId: string, message: string, systemInstruction?: string) => 
    ipcRenderer.invoke('inference:send', sessionId, message, systemInstruction),
  
  // Symbol/Domain Management
  listDomains: () => ipcRenderer.invoke('domain:list'),
  getDomain: (id: string) => ipcRenderer.invoke('domain:get', id),
  getMetadata: () => ipcRenderer.invoke('domain:metadata'),
  searchSymbols: (query: string, limit?: number, options?: any) => 
    ipcRenderer.invoke('domain:search', query, limit, options),
  upsertSymbol: (domainId: string, symbol: any) => 
    ipcRenderer.invoke('domain:upsert-symbol', domainId, symbol),
  getSymbolsByDomain: (domainId: string) => 
    ipcRenderer.invoke('domain:get-symbols', domainId),
  getSymbolById: (id: string) => 
    ipcRenderer.invoke('domain:get-symbol', id),
  deleteSymbol: (domainId: string, symbolId: string) => 
    ipcRenderer.invoke('domain:delete-symbol', domainId, symbolId),
  getSymbolCount: () => ipcRenderer.invoke('domain:get-symbol-count'),
  getDomainCount: () => ipcRenderer.invoke('domain:get-domain-count'),
  
  // Projects
  exportProject: (meta: any) => ipcRenderer.invoke('project:export', meta),
  importProject: () => ipcRenderer.invoke('project:import'),
  importSampleProject: () => ipcRenderer.invoke('project:import-sample'),
  openMonitor: () => ipcRenderer.invoke('window:open-monitor'),
  
  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings: any) => ipcRenderer.invoke('settings:update', settings),
  isInitialized: () => ipcRenderer.invoke('system:is-initialized'),

  // System
  getRecentLogs: (limit?: number) => ipcRenderer.invoke('system:get-recent-logs', limit),
  getTraces: (sessionId: string) => ipcRenderer.invoke('trace:list', sessionId),
  showEmojiPicker: () => ipcRenderer.invoke('system:show-emoji-picker'),
  
  // Agent Management
  listAgents: () => ipcRenderer.invoke('agent:list'),
  upsertAgent: (id: string, prompt: string, enabled: boolean, schedule?: string) => 
    ipcRenderer.invoke('agent:upsert', id, prompt, enabled, schedule),
  deleteAgent: (id: string) => ipcRenderer.invoke('agent:delete', id),
  getAgentLogs: (agentId?: string, limit?: number, includeTraces?: boolean) => 
    ipcRenderer.invoke('agent:logs', agentId, limit, includeTraces),
  
  // Events (Streaming)
  onInferenceChunk: (callback: (chunk: any) => void) => 
    ipcRenderer.on('inference:chunk', (_event, chunk) => callback(chunk)),
  onInferenceCompleted: (callback: () => void) => 
    ipcRenderer.on('inference:completed', () => callback()),
  
  // Trace Events
  onTraceLogged: (callback: (trace: any) => void) => 
    ipcRenderer.on('trace:logged', (_event, trace) => callback(trace)),
  
  onKernelEvent: (callback: (type: string, data: any) => void) => {
    const subscription = (_event, { type, data }) => callback(type, data);
    ipcRenderer.on('kernel:event', subscription);
    return () => ipcRenderer.removeListener('kernel:event', subscription);
  },

  onNavigate: (callback: (view: string) => void) => {
    const subscription = (_event, view) => callback(view);
    ipcRenderer.on('navigate', subscription);
    return () => ipcRenderer.removeListener('navigate', subscription);
  },
  
  removeInferenceListeners: () => {
    ipcRenderer.removeAllListeners('inference:chunk');
    ipcRenderer.removeAllListeners('inference:completed');
    ipcRenderer.removeAllListeners('trace:logged');
    ipcRenderer.removeAllListeners('kernel:event');
  },
  platform: process.platform
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
