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
  setActiveContext: (id: string | null) => ipcRenderer.invoke('context:set-active', id),
  deleteContext: (id: string) => ipcRenderer.invoke('context:delete', id),
  
  // Inference
  sendMessage: (sessionId: string, message: string, systemInstruction?: string, metadata?: Record<string, any>) => 
    ipcRenderer.invoke('inference:send', sessionId, message, systemInstruction, metadata),
  stopInference: () => ipcRenderer.invoke('inference:stop'),
  
  // Symbol/Domain Management
  listDomains: () => ipcRenderer.invoke('domain:list'),
  getDomain: (id: string) => ipcRenderer.invoke('domain:get', id),
  upsertDomain: (id: string, data: any) => ipcRenderer.invoke('domain:upsert', id, data),
  updateDomain: (id: string, data: any) => ipcRenderer.invoke('domain:update', id, data),
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
  deleteDomain: (domainId: string) =>
    ipcRenderer.invoke('domain:delete', domainId),
  getSymbolCount: () => ipcRenderer.invoke('domain:get-symbol-count'),
  getDomainCount: () => ipcRenderer.invoke('domain:get-domain-count'),
  getLinkCount: () => ipcRenderer.invoke('domain:get-link-count'),
  
  // Projects
  exportProject: (meta: any) => ipcRenderer.invoke('project:export', meta),
  importProject: () => ipcRenderer.invoke('project:import'),
  importSampleProject: () => ipcRenderer.invoke('project:import-sample'),
  openMonitor: () => ipcRenderer.invoke('window:open-monitor'),
  
  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings: any) => ipcRenderer.invoke('settings:update', settings),
  validateMcp: (endpoint: string, token?: string) => ipcRenderer.invoke('system:validate-mcp', endpoint, token),
  runHygiene: (strategy?: string) => ipcRenderer.invoke('system:run-hygiene', strategy),
  isInitialized: () => ipcRenderer.invoke('system:is-initialized'),
  pollSource: (sourceId: string) => ipcRenderer.invoke('monitoring:poll-source', sourceId),
  listDeltas: (filter?: any) => ipcRenderer.invoke('monitoring:list-deltas', filter),
  regenerateDelta: (deltaId: string) => ipcRenderer.invoke('monitoring:regenerate-delta', deltaId),
  processAttachment: (file: { name: string, path: string, type: string }) => 
    ipcRenderer.invoke('system:process-attachment', file),
  captureScreenshot: () => ipcRenderer.invoke('system:capture-screenshot'),
  processBase64Attachment: (file: { name: string, data: string, type: string }) => ipcRenderer.invoke('attachment:process-base64', file),

  // Voice
  toggleVoiceMode: (active: boolean) => ipcRenderer.invoke('voice:toggle-mode', active),
  streamAudioInput: (audioData: Float32Array) => ipcRenderer.send('voice:stream-input', audioData),
  onSttResult: (callback: (text: string) => void) => {
    const subscription = (_event, text: string) => callback(text);
    ipcRenderer.on('voice:stt-result', subscription);
    return () => ipcRenderer.removeListener('voice:stt-result', subscription);
  },
  onPlayAudio: (callback: (data: { audio: Float32Array, samplingRate: number }) => void) => {
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('voice:play-audio', subscription);
    return () => ipcRenderer.removeListener('voice:play-audio', subscription);
  },
  onPlayAudioB64: (callback: (data: { audio: string }) => void) => {
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('voice:play-audio-b64', subscription);
    return () => ipcRenderer.removeListener('voice:play-audio-b64', subscription);
  },
  onPlayChunk: (callback: (data: { audio: string, index: number, isLast: boolean }) => void) => {
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('voice:play-chunk', subscription);
    return () => ipcRenderer.removeListener('voice:play-chunk', subscription);
  },
  onStopPlayback: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('voice:stop-playback', subscription);
    return () => ipcRenderer.removeListener('voice:stop-playback', subscription);
  },
  onPlayAckBeep: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('voice:play-ack-beep', subscription);
    return () => ipcRenderer.removeListener('voice:play-ack-beep', subscription);
  },
  onVoiceMatch: (callback: (data: { score: number, speaker: string }) => void) => {
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('voice:match-score', subscription);
    return () => ipcRenderer.removeListener('voice:match-score', subscription);
  },
  onTriggerSubmit: (callback: (data: { text: string, speaker?: string }) => void) => {
    const subscription = (_event, data: { text: string, speaker?: string }) => callback(data);
    ipcRenderer.on('voice:trigger-submit', subscription);
    return () => {
      ipcRenderer.removeListener('voice:trigger-submit', subscription);
    };
  },
  startVoiceEnrollment: (phrase: string) => ipcRenderer.send('voice:enroll-start', { phrase }),
  nextVoiceEnrollmentPhrase: (phrase: string) => ipcRenderer.send('voice:enroll-next', { phrase }),
  stopVoiceEnrollment: (name: string) => ipcRenderer.send('voice:enroll-stop', { name }),
  onVoiceEnrollProgress: (callback: (data: { count: number, verified: boolean, text: string }) => void) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on('voice:enroll-progress', listener);
    return () => ipcRenderer.removeListener('voice:enroll-progress', listener);
  },
  onVoiceEnrollFinalized: (callback: (data: { profile: number[], name: string }) => void) => {
    const subscription = (_event, data: { profile: number[], name: string }) => callback(data);
    ipcRenderer.on('voice:enroll-finalized', subscription);
    return () => ipcRenderer.removeListener('voice:enroll-finalized', subscription);
  },
  notifyPlaybackFinished: () => ipcRenderer.send('voice:playback-finished'),

  // System
  getRecentLogs: (limit?: number) => ipcRenderer.invoke('system:get-recent-logs', limit),
  getTraces: (sessionId: string) => ipcRenderer.invoke('trace:list', sessionId),
  showEmojiPicker: () => ipcRenderer.invoke('system:show-emoji-picker'),
  
  // Agent Management
  listAgents: () => ipcRenderer.invoke('agent:list'),
  upsertAgent: (id: string, prompt: string, enabled: boolean, schedule?: string, subscriptions?: string[]) => 
    ipcRenderer.invoke('agent:upsert', id, prompt, enabled, schedule, subscriptions),
  deleteAgent: (id: string) => ipcRenderer.invoke('agent:delete', id),
  getAgentLogs: (agentId?: string, limit?: number, includeTraces?: boolean) => 
    ipcRenderer.invoke('agent:logs', agentId, limit, includeTraces),
  
  // Prompt Management
  getSystemPrompt: () => ipcRenderer.invoke('system-prompt:get'),
  setSystemPrompt: (prompt: string) => ipcRenderer.invoke('system-prompt:set', prompt),
  getMcpPrompt: () => ipcRenderer.invoke('mcp-prompt:get'),
  setMcpPrompt: (prompt: string) => ipcRenderer.invoke('mcp-prompt:set', prompt),
  
  // Events (Streaming)
  onInferenceChunk: (callback: (chunk: any) => void) => {
    const subscription = (_event, chunk) => callback(chunk);
    ipcRenderer.on('inference:chunk', subscription);
    return () => ipcRenderer.removeListener('inference:chunk', subscription);
  },
  onInferenceCompleted: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('inference:completed', subscription);
    return () => ipcRenderer.removeListener('inference:completed', subscription);
  },
  
  // Trace Events
  onTraceLogged: (callback: (trace: any) => void) => {
    const subscription = (_event, trace) => callback(trace);
    ipcRenderer.on('trace:logged', subscription);
    return () => ipcRenderer.removeListener('trace:logged', subscription);
  },
  
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

  onScreenshotCaptured: (callback: (attachment: any) => void) => {
    const subscription = (_event, attachment) => callback(attachment);
    ipcRenderer.on('screenshot:captured', subscription);
    return () => ipcRenderer.removeListener('screenshot:captured', subscription);
  },
  
  // Realtime
  getRealtimeState: () => ipcRenderer.invoke('realtime:get-state'),
  startRealtimeStream: (type: 'camera' | 'screen' | 'audio') => ipcRenderer.invoke('realtime:start-stream', type),
  stopRealtimeStream: (type: 'camera' | 'screen' | 'audio') => ipcRenderer.invoke('realtime:stop-stream', type),
  toggleRealtimeStream: (type: 'camera' | 'screen' | 'audio') => ipcRenderer.invoke('realtime:toggle-stream', type),
  setVoiceEnabled: (enabled: boolean) => ipcRenderer.invoke('realtime:set-voice-enabled', enabled),
  cancelSpeech: () => ipcRenderer.invoke('realtime:cancel-speech'),
  onRealtimeUpdate: (callback: (update: { type: string, state: any }) => void) => {
    const subscription = (_event, update) => callback(update);
    ipcRenderer.on('realtime:scene-update', subscription);
    return () => ipcRenderer.removeListener('realtime:scene-update', subscription);
  },
  onRealtimeStatusUpdate: (callback: (update: { type: string, status: any }) => void) => {
    const subscription = (_event, update) => callback(update);
    ipcRenderer.on('realtime:status-change', subscription);
    return () => ipcRenderer.removeListener('realtime:status-change', subscription);
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
