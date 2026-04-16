const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bridgeApi', {
  getConfigStatus: () => ipcRenderer.invoke('bridge:get-config-status'),
  getAppSettings: () => ipcRenderer.invoke('bridge:get-app-settings'),
  updateAppSettings: (payload) => ipcRenderer.invoke('bridge:update-app-settings', payload),
  pickAudioFile: () => ipcRenderer.invoke('bridge:pick-audio-file'),
  saveRecording: (payload) => ipcRenderer.invoke('bridge:save-recording', payload),
  dictationStartSession: (payload) => ipcRenderer.invoke('bridge:dictation-session-start', payload),
  dictationStopSession: (payload) => ipcRenderer.invoke('bridge:dictation-session-stop', payload),
  // 连续听写 PCM 走 send 单向推送，避免高频小块等待 invoke 往返。
  dictationPushChunk: (payload) => ipcRenderer.send('bridge:dictation-session-push-chunk', payload),
  captureDesktopScreenshot: (payload) => ipcRenderer.invoke('bridge:capture-desktop-screenshot', payload),
  probeOmniParser: (payload) => ipcRenderer.invoke('bridge:probe-omniparser', payload),
  probePPOcr: (payload) => ipcRenderer.invoke('bridge:probe-ppocr', payload),
  probeSenseVoice: (payload) => ipcRenderer.invoke('bridge:probe-sensevoice', payload),
  applyOcrService: (payload) => ipcRenderer.invoke('bridge:apply-ocr-service', payload),
  testOmniParser: (payload) => ipcRenderer.invoke('bridge:test-omniparser', payload),
  testPPOcr: (payload) => ipcRenderer.invoke('bridge:test-ppocr', payload),
  showCornerIndicators: () => ipcRenderer.invoke('bridge:show-corner-indicators'),
  analyzeAudio: (payload) => ipcRenderer.invoke('bridge:analyze-audio', payload),
  transcribeSenseVoice: (payload) => ipcRenderer.invoke('bridge:transcribe-sensevoice', payload),
  voiceHandleAudio: (payload) => ipcRenderer.invoke('bridge:voice-handle-audio', payload),
  voiceRouteText: (payload) => ipcRenderer.invoke('bridge:voice-route-text', payload),
  voiceReset: () => ipcRenderer.invoke('bridge:voice-reset'),
  // renderer 侧调试日志转发到主进程终端，方便排查连续听写这类只发生在前端的链路。
  voiceLog: (payload) => ipcRenderer.send('bridge:voice-log-renderer', payload),
  onVoiceLog: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('bridge:voice-log', handler)
    return () => ipcRenderer.removeListener('bridge:voice-log', handler)
  },
  onDictationEvent: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('bridge:dictation-event', handler)
    return () => ipcRenderer.removeListener('bridge:dictation-event', handler)
  },
  matchTranscript: (payload) => ipcRenderer.invoke('bridge:match-transcript', payload),
  executePlan: (payload) => ipcRenderer.invoke('bridge:execute-plan', payload),
  listWindows: () => ipcRenderer.invoke('bridge:list-windows'),
  refreshWindows: () => ipcRenderer.invoke('bridge:refresh-windows'),
  getWindowDetail: (handle) => ipcRenderer.invoke('bridge:get-window-detail', handle),
  highlightWindow: (payload) => ipcRenderer.invoke('bridge:highlight-window', payload),
  captureWindow: (handle) => ipcRenderer.invoke('bridge:capture-window', handle),
  getWindowAutomation: (payload) => ipcRenderer.invoke('bridge:get-window-automation', payload),
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
