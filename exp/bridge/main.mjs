import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

import dotenv from 'dotenv'
import { app, BrowserWindow, dialog, ipcMain, screen } from 'electron'

import { captureDesktopScreenshots } from './src/desktopCapture.mjs'
import { parseAudioIntentWithWindows, parseIntentWithWindows } from './src/intentParser.mjs'
import { GlobalShortcutManager } from './src/shortcutManager.mjs'
import { WindowRegistry } from './src/windowRegistry.mjs'
import { executeActionPlan } from './src/windowsController.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const runtimeRoot = path.join(__dirname, '.runtime')
const runtimeUserData = path.join(runtimeRoot, 'user-data')
const runtimeSessionData = path.join(runtimeRoot, 'session-data')
const runtimeLogs = path.join(runtimeRoot, 'logs')
const runtimeScreenshots = path.join(runtimeRoot, 'desktop-captures')

for (const target of [runtimeRoot, runtimeUserData, runtimeSessionData, runtimeLogs, runtimeScreenshots]) {
  fs.mkdirSync(target, { recursive: true })
}

// 显式指定可写的本地运行目录，避免 Electron 默认缓存路径权限异常。
app.setPath('userData', runtimeUserData)
app.setPath('sessionData', runtimeSessionData)
app.setPath('logs', runtimeLogs)

dotenv.config({
  path: path.join(__dirname, '.env'),
})

const windowRegistry = new WindowRegistry()
let mainWindow = null
let overlayWindow = null
let overlayResetTimer = null
let indicatorWindows = []
let indicatorResetTimer = null
let recordingByShortcut = false
const shortcutManager = new GlobalShortcutManager({
  configPath: path.join(runtimeRoot, 'shortcut-config.json'),
  onToggle: ({ triggeredLabel }) => {
    recordingByShortcut = !recordingByShortcut
    mainWindow?.webContents.send('bridge:recording-toggle', {
      source: 'uiohook',
      recording: recordingByShortcut,
      shortcutLabel: triggeredLabel,
    })
  },
  onStateChange: (payload) => {
    mainWindow?.webContents.send('bridge:shortcut-state-push', payload)
  },
})

const OVERLAY_DEFAULT_SIZE = {
  width: 62,
  height: 62,
}
const OVERLAY_MARGIN_BOTTOM = 28
const CORNER_INDICATOR_SIZE = 300
const CORNER_INDICATOR_DURATION_MS = 3000
const CORNER_INDICATOR_BORDER = 8

function disposeIndicatorWindows() {
  if (indicatorResetTimer) {
    clearTimeout(indicatorResetTimer)
    indicatorResetTimer = null
  }

  for (const win of indicatorWindows) {
    if (!win.isDestroyed()) win.destroy()
  }
  indicatorWindows = []
}

function buildIndicatorRects(display) {
  const size = CORNER_INDICATOR_SIZE
  const centers = {
    left: Math.round(display.bounds.width * 0.25),
    right: Math.round(display.bounds.width * 0.75),
    top: Math.round(display.bounds.height * 0.25),
    bottom: Math.round(display.bounds.height * 0.75),
  }

  return [
    { left: centers.left - size / 2, top: centers.top - size / 2 },
    { left: centers.right - size / 2, top: centers.top - size / 2 },
    { left: centers.left - size / 2, top: centers.bottom - size / 2 },
    { left: centers.right - size / 2, top: centers.bottom - size / 2 },
  ].map(item => ({
    left: Math.round(item.left),
    top: Math.round(item.top),
    size,
  }))
}

function buildIndicatorHtml(display) {
  const rects = buildIndicatorRects(display)
  const squares = rects.map((rect) => {
    return `<div class="indicator" style="left:${rect.left}px;top:${rect.top}px;width:${rect.size}px;height:${rect.size}px;"></div>`
  }).join('')

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <style>
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        background: transparent;
        overflow: hidden;
        pointer-events: none;
      }
      .indicator {
        position: absolute;
        box-sizing: border-box;
        border: ${CORNER_INDICATOR_BORDER}px solid #facc15;
        background: transparent;
      }
    </style>
  </head>
  <body>
    ${squares}
  </body>
</html>`
}

async function showCornerIndicators() {
  disposeIndicatorWindows()
  const displays = screen.getAllDisplays()
  const windows = displays.map((display) => {
    const indicatorWindow = new BrowserWindow({
      ...display.bounds,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
    })

    indicatorWindow.setIgnoreMouseEvents(true)
    indicatorWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    return {
      display,
      window: indicatorWindow,
    }
  })

  // 每块屏幕只保留一个透明层窗口，内部绘制四个框，减少窗口数量与合成开销。
  await Promise.all(windows.map(async ({ display, window }) => {
    const html = buildIndicatorHtml(display)
    await window.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`)
  }))

  for (const item of windows) {
    item.window.showInactive()
  }

  indicatorWindows = windows.map(item => item.window)
  indicatorResetTimer = setTimeout(() => {
    disposeIndicatorWindows()
  }, CORNER_INDICATOR_DURATION_MS)

  return {
    ok: true,
    displayCount: displays.length,
    indicatorCount: displays.length * 4,
    overlayWindowCount: windows.length,
    durationMs: CORNER_INDICATOR_DURATION_MS,
    size: CORNER_INDICATOR_SIZE,
  }
}

function computeOverlayBounds(width, height) {
  const display = screen.getPrimaryDisplay()
  const workArea = display.workArea
  // 底部悬浮窗允许跟随内容真实收缩，避免外层窗口残留黑色矩形。
  const targetWidth = Math.max(62, Math.round(width))
  const targetHeight = Math.max(44, Math.round(height))

  return {
    width: targetWidth,
    height: targetHeight,
    x: Math.round(workArea.x + (workArea.width - targetWidth) / 2),
    y: Math.round(workArea.y + workArea.height - targetHeight - OVERLAY_MARGIN_BOTTOM),
  }
}

function pushOverlayState(payload) {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return
  }

  overlayWindow.webContents.send('bridge:overlay-state-push', payload)
}

function setOverlayState(payload) {
  if (overlayResetTimer) {
    clearTimeout(overlayResetTimer)
    overlayResetTimer = null
  }

  pushOverlayState(payload)

  if (payload?.status === 'executing') {
    overlayResetTimer = setTimeout(() => {
      pushOverlayState({
        status: 'idle',
        title: 'Voice Bridge',
        subtitle: '',
      })
    }, payload.autoResetMs ?? 4000)
  }
}

function pushShortcutState(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  mainWindow.webContents.send('bridge:shortcut-state-push', payload)
}

async function executeBridgePlan(plan) {
  const results = []

  for (const step of plan || []) {
    if (step.action === 'focus_window' || step.action === 'close_window') {
      // 指定窗口动作必须按原顺序执行，否则后续键盘输入会落到错误窗口。
      const result = await windowRegistry.performWindowAction({
        action: step.action === 'focus_window' ? 'focus' : 'close',
        // 执行层同时兼容 handle / shortId / id，避免上游字段名差异导致误回退。
        handle: step.args?.handle || step.args?.shortId || step.args?.id,
        processId: step.args?.processId,
      })

      results.push({
        scope: 'window',
        action: step.action,
        result,
      })
      continue
    }

    const result = await executeActionPlan([step])
    results.push({
      scope: 'local',
      action: step.action,
      result,
    })
  }

  return {
    ok: true,
    count: results.length,
    results,
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 900,
    minWidth: 1040,
    minHeight: 760,
    backgroundColor: '#111827',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Electron 始终加载构建后的 React renderer，避免运行时依赖源码入口。
  mainWindow.loadFile(path.join(__dirname, 'renderer-dist', 'index.html'))
  mainWindow.webContents.once('did-finish-load', () => {
    pushShortcutState(shortcutManager.getState())
  })
}

function createOverlayWindow() {
  const bounds = computeOverlayBounds(OVERLAY_DEFAULT_SIZE.width, OVERLAY_DEFAULT_SIZE.height)

  overlayWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlayWindow.loadFile(path.join(__dirname, 'renderer-dist', 'index.html'), {
    query: { mode: 'overlay' },
  })
  overlayWindow.once('ready-to-show', () => {
    overlayWindow.showInactive()
    setOverlayState({
      status: 'idle',
      title: 'Voice Bridge',
      subtitle: '',
    })
  })
}

async function saveRecordingToTemp({ bytes, mimeType }) {
  const tempRoot = path.join(os.tmpdir(), 'voice-bridge-recordings')
  await fsPromises.mkdir(tempRoot, { recursive: true })

  const extension = mimeType?.includes('ogg')
    ? 'ogg'
    : mimeType?.includes('mp4')
      ? 'm4a'
      : mimeType?.includes('mpeg')
        ? 'mp3'
        : 'webm'

  const filePath = path.join(tempRoot, `recording-${Date.now()}.${extension}`)
  await fsPromises.writeFile(filePath, Buffer.from(bytes))
  return filePath
}

app.whenReady().then(async () => {
  createWindow()
  createOverlayWindow()
  await shortcutManager.start()

  ipcMain.handle('bridge:get-config-status', async () => {
    return {
      hasDashscopeApiKey: Boolean(process.env.DASHSCOPE_API_KEY),
      baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: process.env.QWEN_MODEL || 'qwen3-omni-flash',
      platform: process.platform,
      shortcut: shortcutManager.getState(),
    }
  })

  ipcMain.handle('bridge:get-shortcut-state', async () => {
    return shortcutManager.getState()
  })

  ipcMain.handle('bridge:update-shortcut', async (_event, payload) => {
    return shortcutManager.updateShortcut(payload)
  })

  ipcMain.handle('bridge:pick-audio-file', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select audio file',
      properties: ['openFile'],
      filters: [
        {
          name: 'Audio',
          extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'webm'],
        },
      ],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  ipcMain.handle('bridge:save-recording', async (_event, payload) => {
    return saveRecordingToTemp(payload)
  })

  ipcMain.handle('bridge:capture-desktop-screenshot', async (_event, payload = {}) => {
    // 桌面分析统一落盘到项目本地目录，便于后续人工检查与离线处理。
    return captureDesktopScreenshots({
      outputDir: runtimeScreenshots,
      compressed: Boolean(payload.compressed),
      maxHeight: payload.maxHeight ?? 720,
    })
  })

  ipcMain.handle('bridge:show-corner-indicators', async () => {
    return showCornerIndicators()
  })

  ipcMain.handle('bridge:analyze-audio', async (_event, payload) => {
    // 每次发送语音前都强制刷新窗口快照，确保传给 LLM 的是最新前台状态。
    const windows = await windowRegistry.refreshSnapshot()
    const matched = await parseAudioIntentWithWindows(payload.filePath, windows.items, {
      stream: payload.stream,
    })

    return {
      transcript: matched.stt || '',
      usage: matched.usage || null,
      timing: matched.timing || {},
      matched: {
        transcript: matched.transcript,
        stt: matched.stt,
        plan: matched.plan,
        unmatchedSegments: matched.unmatchedSegments,
        safe: matched.safe,
        parser: matched.parser,
        raw: matched.raw,
      },
    }
  })

  ipcMain.handle('bridge:match-transcript', async (_event, transcript) => {
    // 手动文本指令也复用最新窗口快照，避免和语音链路行为不一致。
    const windows = await windowRegistry.refreshSnapshot()
    return parseIntentWithWindows(transcript, windows.items)
  })

  ipcMain.handle('bridge:execute-plan', async (_event, payload) => {
    return executeBridgePlan(payload.plan)
  })

  ipcMain.handle('bridge:list-windows', async () => {
    return windowRegistry.listWindows()
  })

  ipcMain.handle('bridge:refresh-windows', async () => {
    // 窗口列表由主进程维护快照，前端通过手动刷新更新状态。
    return windowRegistry.refreshSnapshot()
  })

  ipcMain.handle('bridge:get-window-detail', async (_event, handle) => {
    return windowRegistry.getWindowDetail(handle)
  })

  ipcMain.handle('bridge:window-action', async (_event, payload) => {
    return windowRegistry.performWindowAction(payload)
  })

  ipcMain.handle('bridge:update-overlay-layout', async (_event, payload) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      return null
    }

    const bounds = computeOverlayBounds(
      payload?.width ?? OVERLAY_DEFAULT_SIZE.width,
      payload?.height ?? OVERLAY_DEFAULT_SIZE.height,
    )
    overlayWindow.setBounds(bounds, true)
    return bounds
  })

  ipcMain.on('bridge:overlay-state', (_event, payload) => {
    if (payload?.status === 'listening') {
      recordingByShortcut = true
    }

    if (payload?.status === 'waiting' || payload?.status === 'executing' || payload?.status === 'idle') {
      if (payload.status !== 'listening') {
        recordingByShortcut = false
      }
    }

    setOverlayState(payload)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
      createOverlayWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  disposeIndicatorWindows()
  shortcutManager.stop()
})
