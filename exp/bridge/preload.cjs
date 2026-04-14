const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bridgeApi', {
  getConfigStatus: () => ipcRenderer.invoke('bridge:get-config-status'),
  pickAudioFile: () => ipcRenderer.invoke('bridge:pick-audio-file'),
  saveRecording: (payload) => ipcRenderer.invoke('bridge:save-recording', payload),
  analyzeAudio: (payload) => ipcRenderer.invoke('bridge:analyze-audio', payload),
  matchTranscript: (transcript) => ipcRenderer.invoke('bridge:match-transcript', transcript),
  executePlan: (payload) => ipcRenderer.invoke('bridge:execute-plan', payload),
  listWindows: () => ipcRenderer.invoke('bridge:list-windows'),
  refreshWindows: () => ipcRenderer.invoke('bridge:refresh-windows'),
  getWindowDetail: (handle) => ipcRenderer.invoke('bridge:get-window-detail', handle),
  windowAction: (payload) => ipcRenderer.invoke('bridge:window-action', payload),
  getShortcutState: () => ipcRenderer.invoke('bridge:get-shortcut-state'),
  updateShortcut: (payload) => ipcRenderer.invoke('bridge:update-shortcut', payload),
  notifyOverlayState: (payload) => ipcRenderer.send('bridge:overlay-state', payload),
  updateOverlayLayout: (payload) => ipcRenderer.invoke('bridge:update-overlay-layout', payload),
  onOverlayState: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('bridge:overlay-state-push', handler)
    return () => ipcRenderer.removeListener('bridge:overlay-state-push', handler)
  },
  onRecordingToggle: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('bridge:recording-toggle', handler)
    return () => ipcRenderer.removeListener('bridge:recording-toggle', handler)
  },
  onShortcutState: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('bridge:shortcut-state-push', handler)
    return () => ipcRenderer.removeListener('bridge:shortcut-state-push', handler)
  },
})
