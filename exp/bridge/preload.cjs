const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bridgeApi', {
  getConfigStatus: () => ipcRenderer.invoke('bridge:get-config-status'),
  pickAudioFile: () => ipcRenderer.invoke('bridge:pick-audio-file'),
  saveRecording: (payload) => ipcRenderer.invoke('bridge:save-recording', payload),
  analyzeAudio: (payload) => ipcRenderer.invoke('bridge:analyze-audio', payload),
  matchTranscript: (transcript) => ipcRenderer.invoke('bridge:match-transcript', transcript),
  executePlan: (payload) => ipcRenderer.invoke('bridge:execute-plan', payload),
})
