import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import dotenv from 'dotenv'
import { app, BrowserWindow, dialog, ipcMain, screen } from 'electron'

import { captureDesktopScreenshots } from './src/desktopCapture.mjs'
import { parseAudioIntentWithWindows, parseIntentWithWindows } from './src/intentParser.mjs'
import { probeOmniParser, testOmniParserWithImage } from './src/omniParserClient.mjs'
import { probePPOcr, testPPOcrWithImage } from './src/ppOcrClient.mjs'
import { listProviderStatuses, normalizeProvider } from './src/providerConfig.mjs'
import { probeSenseVoice, transcribeSenseVoiceAudio } from './src/senseVoiceClient.mjs'
import { GlobalShortcutManager } from './src/shortcutManager.mjs'
import { createVoiceActionRouter } from './src/voiceActionRouter.mjs'
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
let managedSenseVoiceProcess = null
let managedSenseVoiceState = {
  autostart: process.env.SENSEVOICE_AUTOSTART !== 'false',
  status: 'idle',
  pid: null,
  lastError: '',
}
let managedPPOcrProcess = null
let managedPPOcrState = {
  autostart: process.env.PPOCR_AUTOSTART !== 'false',
  status: 'idle',
  pid: null,
  lastError: '',
  warmed: false,
}
let voiceRouter = null
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
const WINDOW_HIGHLIGHT_DURATION_MS = 3000
const WINDOW_HIGHLIGHT_BORDER = 4
const CANDIDATE_HIGHLIGHT_PADDING = 20
const SENSEVOICE_DEFAULT_BASE_URL = process.env.SENSEVOICE_BASE_URL || 'http://127.0.0.1:8010'
const SENSEVOICE_CAPABILITY_ROOT = path.join(__dirname, 'capabilities', 'sensevoice')
const SENSEVOICE_LOCAL_ROOT = path.join(SENSEVOICE_CAPABILITY_ROOT, '.local')
const SENSEVOICE_PYTHON_PATH = path.join(SENSEVOICE_LOCAL_ROOT, '.venv', 'Scripts', 'python.exe')
const SENSEVOICE_SERVER_PATH = path.join(SENSEVOICE_CAPABILITY_ROOT, 'service', 'server.py')
const PPOCR_DEFAULT_BASE_URL = process.env.PPOCR_BASE_URL || 'http://127.0.0.1:8020'
const PPOCR_CAPABILITY_ROOT = path.join(__dirname, 'capabilities', 'ppocr')
const PPOCR_LOCAL_ROOT = path.join(PPOCR_CAPABILITY_ROOT, '.local')
const PPOCR_PYTHON_PATH = path.join(PPOCR_LOCAL_ROOT, '.venv', 'Scripts', 'python.exe')
const PPOCR_SERVER_PATH = path.join(PPOCR_CAPABILITY_ROOT, 'service', 'server.py')
// 1x1 透明像素 PNG，用于 PP-OCR 首次调用预热 lru_cache 里的模型。
const WARMUP_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='

function buildTimestampToken(date = new Date()) {
  const pad = value => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')
}

function disposeIndicatorWindows() {
  if (indicatorResetTimer) {
    clearTimeout(indicatorResetTimer)
    indicatorResetTimer = null
  }

  for (const item of indicatorWindows) {
    if (!item.window.isDestroyed()) item.window.destroy()
  }
  indicatorWindows = []
}

async function clearIndicatorWindows() {
  if (indicatorResetTimer) {
    clearTimeout(indicatorResetTimer)
    indicatorResetTimer = null
  }

  // 常驻透明层只清空内容，不做 hide/show，避免系统窗口动画影响观感。
  for (const item of indicatorWindows) {
    if (!item.window.isDestroyed()) {
      await item.window.webContents.executeJavaScript(
        `window.renderIndicators(${JSON.stringify({ items: [] })})`,
        true,
      )
    }
  }
}

function buildIndicatorWindowHtml() {
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
      #root {
        position: relative;
        width: 100%;
        height: 100%;
      }
      .indicator {
        position: absolute;
        box-sizing: border-box;
        background: transparent;
      }
      .indicator--corner {
        border: ${CORNER_INDICATOR_BORDER}px solid #facc15;
      }
      .indicator--window {
        border: ${WINDOW_HIGHLIGHT_BORDER}px solid #facc15;
        box-shadow: 0 0 0 1px rgba(250, 204, 21, 0.32);
      }
      .indicator--numbered {
        border: 3px solid #38bdf8;
        box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.35), 0 0 12px rgba(56, 189, 248, 0.45);
      }
      .indicator__badge {
        position: absolute;
        top: 50%;
        min-width: 22px;
        height: 22px;
        padding: 0 6px;
        border-radius: 11px;
        background: #facc15;
        color: #111827;
        font: 700 13px/22px "Segoe UI", system-ui, sans-serif;
        text-align: center;
        box-shadow: 0 1px 4px rgba(0,0,0,0.35);
        transform: translateY(-50%);
      }
      .indicator__badge--right {
        left: calc(100% + 8px);
      }
      .indicator__badge--left {
        right: calc(100% + 8px);
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>
      window.renderIndicators = function renderIndicators(payload) {
        const root = document.getElementById('root')
        if (!root) return false

        const items = Array.isArray(payload && payload.items) ? payload.items : []
        root.innerHTML = items.map((item) => {
          const left = Math.round(item.left || 0)
          const top = Math.round(item.top || 0)
          const width = Math.max(0, Math.round(item.width || 0))
          const height = Math.max(0, Math.round(item.height || 0))
          const type = item.type === 'window' ? 'window' : item.type === 'numbered' ? 'numbered' : 'corner'
          const badge = (type === 'numbered' && item.label != null)
            ? '<div class="indicator__badge indicator__badge--' + (item.badgeSide === 'left' ? 'left' : 'right') + '">' + String(item.label) + '</div>'
            : ''
          return '<div class="indicator indicator--' + type + '" style="left:' + left + 'px;top:' + top + 'px;width:' + width + 'px;height:' + height + 'px;">' + badge + '</div>'
        }).join('')

        return items.length > 0
      }
    </script>
  </body>
</html>`
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
    width: size,
    height: size,
  }))
}

function buildDisplaySignature(displays) {
  return displays
    .map((display) => `${display.id}:${display.bounds.x},${display.bounds.y},${display.bounds.width},${display.bounds.height}`)
    .join('|')
}

async function ensureIndicatorWindows() {
  const displays = screen.getAllDisplays()
  const signature = buildDisplaySignature(displays)
  const currentSignature = buildDisplaySignature(indicatorWindows.map((item) => item.display))
  const needsRebuild =
    indicatorWindows.length !== displays.length ||
    currentSignature !== signature ||
    indicatorWindows.some((item) => item.window.isDestroyed())

  if (!needsRebuild) {
    return indicatorWindows
  }

  disposeIndicatorWindows()

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
    indicatorWindow.setAlwaysOnTop(true, 'screen-saver')
    indicatorWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    return {
      display,
      window: indicatorWindow,
    }
  })

  await Promise.all(windows.map(async ({ display, window }) => {
    // 每块屏幕只保留一个长期驻留的透明层，后续只更新内部 DOM，避免频繁创建销毁窗口。
    void display
    await window.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(buildIndicatorWindowHtml())}`)
    window.showInactive()
  }))

  indicatorWindows = windows
  return indicatorWindows
}

function buildWindowHighlightRects(bounds, displays) {
  return displays.map((display) => {
    const sourceBounds = getDisplaySourceBounds(display)
    const left = Math.max(bounds.x, sourceBounds.x)
    const top = Math.max(bounds.y, sourceBounds.y)
    const right = Math.min(bounds.x + bounds.width, sourceBounds.x + sourceBounds.width)
    const bottom = Math.min(bounds.y + bounds.height, sourceBounds.y + sourceBounds.height)

    if (right <= left || bottom <= top) {
      return {
        displayId: display.id,
        items: [],
      }
    }

    return {
      displayId: display.id,
      items: [
        {
          type: 'window',
          left: left - sourceBounds.x,
          top: top - sourceBounds.y,
          width: right - left,
          height: bottom - top,
        },
      ],
    }
  })
}

function normalizeRectangle(bounds) {
  return {
    x: Math.round(Number(bounds?.x ?? 0)),
    y: Math.round(Number(bounds?.y ?? 0)),
    width: Math.max(0, Math.round(Number(bounds?.width ?? 0))),
    height: Math.max(0, Math.round(Number(bounds?.height ?? 0))),
  }
}

function getDisplaySourceBounds(display) {
  const origin = display.nativeOrigin || display.bounds
  return {
    // 副屏的全局原点要按系统真实拼接位置取，不能直接复用 Electron 的 bounds.x/y。
    x: Math.round(origin.x),
    y: Math.round(origin.y),
    // 当前高亮宽高已经正确，这里继续沿用逻辑尺寸，不再额外缩放。
    width: Math.round(display.bounds.width),
    height: Math.round(display.bounds.height),
  }
}

async function renderIndicators(rectGroups, durationMs) {
  const windows = await ensureIndicatorWindows()
  const groupsByDisplayId = new Map(rectGroups.map((item) => [item.displayId, item.items]))

  // 常驻透明层始终存在，这里只更新每块屏幕内部的高亮内容。
  for (const item of windows) {
    const items = groupsByDisplayId.get(item.display.id) || []
    await item.window.webContents.executeJavaScript(
      `window.renderIndicators(${JSON.stringify({ items })})`,
      true,
    )
  }

  indicatorResetTimer = setTimeout(() => {
    void clearIndicatorWindows()
  }, durationMs)
}

async function rebuildIndicatorWindows() {
  // 显示器布局变化后立即后台重建，避免下一次点击才触发初始化延迟。
  disposeIndicatorWindows()
  await ensureIndicatorWindows()
}

async function showCornerIndicators() {
  const displays = screen.getAllDisplays()
  const rectGroups = displays.map((display) => ({
    displayId: display.id,
    items: buildIndicatorRects(display).map((item) => ({
      ...item,
      type: 'corner',
    })),
  }))

  await renderIndicators(rectGroups, CORNER_INDICATOR_DURATION_MS)
  return {
    ok: true,
    displayCount: displays.length,
    indicatorCount: displays.length * 4,
    overlayWindowCount: displays.length,
    durationMs: CORNER_INDICATOR_DURATION_MS,
    size: CORNER_INDICATOR_SIZE,
  }
}

async function highlightWindowBounds(bounds) {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    throw new Error('窗口位置无效，无法高亮')
  }

  const displays = screen.getAllDisplays()
  const normalizedBounds = normalizeRectangle(bounds)
  const rectGroups = buildWindowHighlightRects(normalizedBounds, displays)
  const visibleCount = rectGroups.reduce((count, item) => count + item.items.length, 0)
  if (visibleCount === 0) {
    throw new Error('窗口当前不在任何显示器可见区域内')
  }

  await renderIndicators(rectGroups, WINDOW_HIGHLIGHT_DURATION_MS)
  return {
    ok: true,
    displayCount: displays.length,
    highlightedDisplayCount: visibleCount,
    durationMs: WINDOW_HIGHLIGHT_DURATION_MS,
    bounds: normalizedBounds,
  }
}

// 窗口高亮优先复用前端刚拿到的 bounds，避免每次点击都重新做一次系统窗口枚举。
async function highlightWindow(payload = {}) {
  const directBounds = payload?.bounds
  if (directBounds?.width > 0 && directBounds?.height > 0) {
    if (payload?.state === 'minimized') {
      throw new Error('最小化窗口无法直接高亮，请先恢复窗口')
    }

    return highlightWindowBounds(directBounds)
  }

  const handle = String(payload?.handle || payload?.shortId || '')
  if (!handle) {
    throw new Error('缺少窗口句柄，无法高亮')
  }

  // 先用主进程已有快照，只有命中失败时才回退到真实刷新，减少点击延迟。
  let snapshot = await windowRegistry.listWindows()
  let target = snapshot.items.find(
    (item) => item.handle === handle || item.shortId === handle,
  )

  if (!target) {
    snapshot = await windowRegistry.refreshSnapshot()
    target = snapshot.items.find(
      (item) => item.handle === handle || item.shortId === handle,
    )
  }

  if (!target) {
    throw new Error(`Window not found: ${handle}`)
  }
  if (target.state === 'minimized') {
    throw new Error('最小化窗口无法直接高亮，请先恢复窗口')
  }

  return highlightWindowBounds(target.bounds)
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

function parseSenseVoiceBaseUrl() {
  try {
    return new URL(SENSEVOICE_DEFAULT_BASE_URL)
  } catch {
    return new URL('http://127.0.0.1:8010')
  }
}

function isLocalSenseVoiceUrl(url) {
  return ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
}

function buildSenseVoiceEnv() {
  const cacheRoot = path.join(SENSEVOICE_LOCAL_ROOT, 'cache')
  return {
    ...process.env,
    PIP_CACHE_DIR: path.join(cacheRoot, 'pip'),
    HF_HOME: path.join(cacheRoot, 'hf'),
    HUGGINGFACE_HUB_CACHE: path.join(cacheRoot, 'hf', 'hub'),
    MODELSCOPE_CACHE: path.join(cacheRoot, 'modelscope'),
    TEMP: path.join(cacheRoot, 'tmp'),
    TMP: path.join(cacheRoot, 'tmp'),
  }
}

async function isSenseVoiceReachable(timeoutMs = 1000) {
  try {
    await probeSenseVoice({ timeoutMs })
    return true
  } catch {
    return false
  }
}

async function waitForManagedSenseVoiceReady() {
  // 子服务启动和 Python import 需要几秒，后台轮询状态但不阻塞 Electron 界面。
  for (let index = 0; index < 45; index += 1) {
    if (await isSenseVoiceReachable(1000)) {
      managedSenseVoiceState = {
        ...managedSenseVoiceState,
        status: 'ready',
        pid: managedSenseVoiceProcess?.pid || managedSenseVoiceState.pid,
        lastError: '',
      }
      return
    }

    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  managedSenseVoiceState = {
    ...managedSenseVoiceState,
    status: 'starting',
    lastError: 'SenseVoice 服务启动中，但探活尚未完成。',
  }
}

async function startManagedSenseVoiceService() {
  // Electron 启动时自动托管本地 SenseVoice，用户只需要在设置页决定是否使用识别结果。
  const baseUrl = parseSenseVoiceBaseUrl()
  managedSenseVoiceState = {
    ...managedSenseVoiceState,
    autostart: process.env.SENSEVOICE_AUTOSTART !== 'false',
  }

  if (!managedSenseVoiceState.autostart) {
    managedSenseVoiceState = { ...managedSenseVoiceState, status: 'disabled', lastError: '' }
    return
  }

  if (!isLocalSenseVoiceUrl(baseUrl)) {
    managedSenseVoiceState = {
      ...managedSenseVoiceState,
      status: 'external',
      lastError: 'SENSEVOICE_BASE_URL 指向非本机地址，跳过自动启动。',
    }
    return
  }

  if (await isSenseVoiceReachable(800)) {
    managedSenseVoiceState = { ...managedSenseVoiceState, status: 'external', lastError: '' }
    return
  }

  if (!fs.existsSync(SENSEVOICE_PYTHON_PATH) || !fs.existsSync(SENSEVOICE_SERVER_PATH)) {
    managedSenseVoiceState = {
      ...managedSenseVoiceState,
      status: 'missing',
      lastError: 'SenseVoice 本地部署不存在，请先运行 npm run capability:sensevoice:setup。',
    }
    return
  }

  if (managedSenseVoiceProcess && !managedSenseVoiceProcess.killed) {
    return
  }

  fs.mkdirSync(path.join(SENSEVOICE_LOCAL_ROOT, 'cache', 'tmp'), { recursive: true })
  const stdoutLog = fs.createWriteStream(path.join(runtimeLogs, 'sensevoice.managed.stdout.log'), { flags: 'a' })
  const stderrLog = fs.createWriteStream(path.join(runtimeLogs, 'sensevoice.managed.stderr.log'), { flags: 'a' })
  const host = baseUrl.hostname === 'localhost' ? '127.0.0.1' : baseUrl.hostname
  const port = baseUrl.port || '8010'

  managedSenseVoiceProcess = spawn(SENSEVOICE_PYTHON_PATH, [
    SENSEVOICE_SERVER_PATH,
    '--host',
    host,
    '--port',
    port,
    '--device',
    process.env.SENSEVOICE_DEVICE || 'cpu',
  ], {
    cwd: __dirname,
    env: buildSenseVoiceEnv(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  managedSenseVoiceProcess.stdout.pipe(stdoutLog)
  managedSenseVoiceProcess.stderr.pipe(stderrLog)
  managedSenseVoiceState = {
    ...managedSenseVoiceState,
    status: 'starting',
    pid: managedSenseVoiceProcess.pid,
    lastError: '',
  }

  managedSenseVoiceProcess.on('error', (error) => {
    managedSenseVoiceState = {
      ...managedSenseVoiceState,
      status: 'error',
      pid: null,
      lastError: String(error.message || error),
    }
  })

  managedSenseVoiceProcess.on('exit', (code, signal) => {
    if (managedSenseVoiceProcess) {
      managedSenseVoiceState = {
        ...managedSenseVoiceState,
        status: code === 0 ? 'stopped' : 'error',
        pid: null,
        lastError: code === 0 ? '' : `SenseVoice 服务已退出，code=${code}, signal=${signal || ''}`,
      }
    }
    managedSenseVoiceProcess = null
  })

  waitForManagedSenseVoiceReady().catch((error) => {
    managedSenseVoiceState = {
      ...managedSenseVoiceState,
      status: 'error',
      lastError: String(error.message || error),
    }
  })
}

async function ensureManagedSenseVoiceServiceReady() {
  // 首次本地识别可能早于服务启动完成，这里兜底等待探活成功。
  if (await isSenseVoiceReachable(1000)) {
    return
  }

  await startManagedSenseVoiceService()
  if (managedSenseVoiceState.status === 'starting') {
    await waitForManagedSenseVoiceReady()
  }
}

function stopManagedSenseVoiceService() {
  // 只回收本次 Electron 托管的子进程，外部用户自行启动的服务不处理。
  if (managedSenseVoiceProcess && !managedSenseVoiceProcess.killed) {
    managedSenseVoiceProcess.kill()
  }
  managedSenseVoiceProcess = null
}

function parsePPOcrBaseUrl() {
  try { return new URL(PPOCR_DEFAULT_BASE_URL) } catch { return new URL('http://127.0.0.1:8020') }
}

function isLocalPPOcrUrl(url) {
  return ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
}

async function isPPOcrReachable(timeoutMs = 1000) {
  try {
    await probePPOcr({ timeoutMs })
    return true
  } catch { return false }
}

async function waitForManagedPPOcrReady() {
  for (let index = 0; index < 60; index += 1) {
    if (await isPPOcrReachable(1000)) {
      managedPPOcrState = { ...managedPPOcrState, status: 'ready', pid: managedPPOcrProcess?.pid || managedPPOcrState.pid, lastError: '' }
      return
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  managedPPOcrState = { ...managedPPOcrState, status: 'starting', lastError: 'PP-OCR 服务启动中，但探活尚未完成。' }
}

async function startManagedPPOcrService() {
  const baseUrl = parsePPOcrBaseUrl()
  managedPPOcrState = { ...managedPPOcrState, autostart: process.env.PPOCR_AUTOSTART !== 'false' }

  if (!managedPPOcrState.autostart) {
    managedPPOcrState = { ...managedPPOcrState, status: 'disabled', lastError: '' }
    return
  }
  if (!isLocalPPOcrUrl(baseUrl)) {
    managedPPOcrState = { ...managedPPOcrState, status: 'external', lastError: 'PPOCR_BASE_URL 指向非本机地址，跳过自动启动。' }
    return
  }
  if (await isPPOcrReachable(800)) {
    managedPPOcrState = { ...managedPPOcrState, status: 'external', lastError: '' }
    return
  }
  if (!fs.existsSync(PPOCR_PYTHON_PATH) || !fs.existsSync(PPOCR_SERVER_PATH)) {
    managedPPOcrState = { ...managedPPOcrState, status: 'missing', lastError: 'PP-OCR 本地部署不存在，请先运行 npm run capability:ppocr:setup。' }
    return
  }
  if (managedPPOcrProcess && !managedPPOcrProcess.killed) return

  fs.mkdirSync(path.join(PPOCR_LOCAL_ROOT, 'cache'), { recursive: true })
  const stdoutLog = fs.createWriteStream(path.join(runtimeLogs, 'ppocr.managed.stdout.log'), { flags: 'a' })
  const stderrLog = fs.createWriteStream(path.join(runtimeLogs, 'ppocr.managed.stderr.log'), { flags: 'a' })
  const host = baseUrl.hostname === 'localhost' ? '127.0.0.1' : baseUrl.hostname
  const port = baseUrl.port || '8020'

  managedPPOcrProcess = spawn(PPOCR_PYTHON_PATH, [
    PPOCR_SERVER_PATH,
    '--host', host,
    '--port', port,
    '--device', process.env.PPOCR_DEVICE || 'cpu',
  ], {
    cwd: __dirname,
    env: { ...process.env },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  managedPPOcrProcess.stdout.pipe(stdoutLog)
  managedPPOcrProcess.stderr.pipe(stderrLog)
  managedPPOcrState = { ...managedPPOcrState, status: 'starting', pid: managedPPOcrProcess.pid, lastError: '' }

  managedPPOcrProcess.on('error', (error) => {
    managedPPOcrState = { ...managedPPOcrState, status: 'error', pid: null, lastError: String(error.message || error) }
  })
  managedPPOcrProcess.on('exit', (code, signal) => {
    if (managedPPOcrProcess) {
      managedPPOcrState = {
        ...managedPPOcrState,
        status: code === 0 ? 'stopped' : 'error',
        pid: null,
        lastError: code === 0 ? '' : `PP-OCR 服务已退出，code=${code}, signal=${signal || ''}`,
      }
    }
    managedPPOcrProcess = null
  })

  waitForManagedPPOcrReady()
    .then(() => { void warmupPPOcr() })
    .catch((error) => {
      managedPPOcrState = { ...managedPPOcrState, status: 'error', lastError: String(error.message || error) }
    })
}

async function ensureManagedPPOcrServiceReady() {
  if (await isPPOcrReachable(1000)) return
  await startManagedPPOcrService()
  if (managedPPOcrState.status === 'starting') {
    await waitForManagedPPOcrReady()
  }
}

async function warmupPPOcr() {
  // 服务 ready 后触发一次 1x1 PNG 推理，命中 lru_cache 里的 PaddleOCR 初始化。
  if (managedPPOcrState.warmed) return
  try {
    const response = await fetch(`${PPOCR_DEFAULT_BASE_URL.replace(/\/+$/, '')}/parse/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64_image: WARMUP_PNG_BASE64 }),
      signal: AbortSignal.timeout(60000),
    })
    if (response.ok) {
      managedPPOcrState = { ...managedPPOcrState, warmed: true }
      console.log('[ppocr] warmup complete')
    } else {
      console.warn('[ppocr] warmup non-200:', response.status)
    }
  } catch (error) {
    console.warn('[ppocr] warmup failed:', error.message || error)
  }
}

function stopManagedPPOcrService() {
  if (managedPPOcrProcess && !managedPPOcrProcess.killed) {
    managedPPOcrProcess.kill()
  }
  managedPPOcrProcess = null
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

async function capturePrimaryDesktopForOmniParser(payload = {}) {
  // OmniParser 测试固定抓取主屏，避免多屏结果混在一起影响调试判断。
  const captureResult = await captureDesktopScreenshots({
    outputDir: runtimeScreenshots,
    compressed: payload.compressed ?? true,
    maxHeight: payload.maxHeight ?? 1080,
  })
  const targetDisplay = captureResult.items.find(item => item.isPrimary) || captureResult.items[0]
  if (!targetDisplay) {
    throw new Error('当前没有可用于 OmniParser 测试的桌面截图。')
  }

  return {
    captureResult,
    targetDisplay,
  }
}

async function captureWindowImage(handle) {
  const detail = await windowRegistry.getWindowDetail(handle)
  const target = detail.item
  const fileName = `window-${target.shortId.toLowerCase()}-${buildTimestampToken()}.png`
  const outputPath = path.join(runtimeScreenshots, fileName)
  const result = await windowRegistry.captureWindow(target.handle, outputPath)

  return {
    ...result.capture,
    item: result.item,
    updatedAt: result.updatedAt,
  }
}

// 视觉能力的标注图统一回写到截图目录，便于后续人工复核与对比。
async function saveAnnotatedImageFromDataUrl(imageDataUrl, sourceImagePath, suffix) {
  if (!imageDataUrl) {
    return ''
  }

  const [meta, base64Payload] = String(imageDataUrl).split(',', 2)
  if (!meta?.startsWith('data:image/') || !base64Payload) {
    throw new Error('视觉能力标注图格式无效，无法保存到本地。')
  }

  const parsedPath = path.parse(sourceImagePath)
  const outputPath = path.join(parsedPath.dir, `${parsedPath.name}-${suffix}.png`)
  await fsPromises.writeFile(outputPath, Buffer.from(base64Payload, 'base64'))
  return outputPath
}

// 语音点击链路：截主屏原图 → 调 PP-OCR → 返回 OCR 行 + 坐标换算所需元数据。
async function captureAndOcrPrimaryDisplay() {
  const captureStartAt = Date.now()
  await ensureManagedPPOcrServiceReady()
  const captureResult = await captureDesktopScreenshots({
    outputDir: runtimeScreenshots,
    compressed: false,
    maxHeight: 9999,
  })
  const item = captureResult.items.find(it => it.isPrimary) || captureResult.items[0]
  if (!item) throw new Error('未能抓取主屏截图')
  console.log(`[${new Date().toISOString()}] [voice] capture completed in ${Date.now() - captureStartAt}ms: ${item.savedPath}`)

  const display = screen.getAllDisplays().find(d => d.id === item.displayId) || screen.getPrimaryDisplay()
  const logicalWidth = display.bounds.width
  const scaleFactor = item.width / Math.max(1, logicalWidth)
  const origin = display.nativeOrigin || display.bounds

  const ocrStartAt = Date.now()
  const parseResult = await testPPOcrWithImage(item.savedPath)
  console.log(`[${new Date().toISOString()}] [voice] ppocr completed in ${Date.now() - ocrStartAt}ms: lines=${parseResult.lineCount || 0}`)
  return {
    ocrLines: parseResult.ocrLines || [],
    lineCount: parseResult.lineCount || 0,
    imagePath: item.savedPath,
    imageWidth: item.width,
    imageHeight: item.height,
    displayId: display.id,
    scaleFactor,
    originX: Math.round(origin.x),
    originY: Math.round(origin.y),
  }
}

// 候选高亮：在对应屏幕的指示层上画带编号的框；不自动清除，由语音 FSM 控制生命周期。
async function renderCandidateHighlights({ displayId, items }) {
  const windows = await ensureIndicatorWindows()
  // FSM 新一轮候选渲染前主动清掉上一次残留。
  if (indicatorResetTimer) { clearTimeout(indicatorResetTimer); indicatorResetTimer = null }

  for (const w of windows) {
    const payload = w.display.id === displayId
      ? (items || []).map((it) => {
          const left = Math.max(0, it.overlayRect.left - CANDIDATE_HIGHLIGHT_PADDING)
          const top = Math.max(0, it.overlayRect.top - CANDIDATE_HIGHLIGHT_PADDING)
          const right = Math.min(
            w.display.bounds.width,
            it.overlayRect.left + it.overlayRect.width + CANDIDATE_HIGHLIGHT_PADDING,
          )
          const bottom = Math.min(
            w.display.bounds.height,
            it.overlayRect.top + it.overlayRect.height + CANDIDATE_HIGHLIGHT_PADDING,
          )
          const badgeSide = right + 48 <= w.display.bounds.width ? 'right' : 'left'

          // 候选框围绕原 bbox 居中外扩 20px，并把编号放到右侧；右边越界时切到左侧。
          return {
            type: 'numbered',
            left,
            top,
            width: Math.max(1, right - left),
            height: Math.max(1, bottom - top),
            label: String(it.index),
            badgeSide,
          }
        })
      : []
    await w.window.webContents.executeJavaScript(
      `window.renderIndicators(${JSON.stringify({ items: payload })})`,
      true,
    )
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
  startManagedSenseVoiceService().catch((error) => {
    managedSenseVoiceState = {
      ...managedSenseVoiceState,
      status: 'error',
      lastError: String(error.message || error),
    }
  })
  startManagedPPOcrService().catch((error) => {
    managedPPOcrState = { ...managedPPOcrState, status: 'error', lastError: String(error.message || error) }
  })
  voiceRouter = createVoiceActionRouter({
    captureAndOcr: captureAndOcrPrimaryDisplay,
    highlightCandidates: renderCandidateHighlights,
    clearIndicators: clearIndicatorWindows,
    clickAt: async (x, y) => executeActionPlan([{ action: 'click_at', args: { x, y } }]),
    logger: (msg) => {
      const at = new Date().toISOString()
      const message = `[${at}] ${msg}`
      console.log(message)
      mainWindow?.webContents.send('bridge:voice-log', { message, at })
    },
    notifyOverlay: (payload) => setOverlayState(payload),
  })
  createWindow()
  createOverlayWindow()
  await ensureIndicatorWindows()
  // 指示层启动后立即预热，后续只改 DOM 内容，不再等首次点击才建窗口。
  screen.on('display-added', () => {
    rebuildIndicatorWindows().catch(() => {})
  })
  screen.on('display-removed', () => {
    rebuildIndicatorWindows().catch(() => {})
  })
  screen.on('display-metrics-changed', () => {
    rebuildIndicatorWindows().catch(() => {})
  })
  await shortcutManager.start()

  ipcMain.handle('bridge:get-config-status', async () => {
    return {
      hasDashscopeApiKey: Boolean(process.env.DASHSCOPE_API_KEY),
      baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: process.env.QWEN_MODEL || 'qwen3-omni-flash',
      providers: listProviderStatuses(),
      omniparser: {
        baseURL: process.env.OMNIPARSER_BASE_URL || 'http://127.0.0.1:8000',
      },
      ppocr: {
        baseURL: process.env.PPOCR_BASE_URL || 'http://127.0.0.1:8020',
      },
      sensevoice: {
        baseURL: process.env.SENSEVOICE_BASE_URL || 'http://127.0.0.1:8010',
        managed: managedSenseVoiceState,
      },
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

  ipcMain.handle('bridge:probe-omniparser', async (_event, payload = {}) => {
    return probeOmniParser(payload)
  })

  ipcMain.handle('bridge:probe-ppocr', async (_event, payload = {}) => {
    return probePPOcr(payload)
  })

  ipcMain.handle('bridge:probe-sensevoice', async (_event, payload = {}) => {
    await ensureManagedSenseVoiceServiceReady()
    return probeSenseVoice(payload)
  })

  ipcMain.handle('bridge:test-omniparser', async (_event, payload = {}) => {
    const { captureResult, targetDisplay } = await capturePrimaryDesktopForOmniParser(payload)
    const parseResult = await testOmniParserWithImage(targetDisplay.savedPath, payload)
    const annotatedImagePath = await saveAnnotatedImageFromDataUrl(
      parseResult.somImageDataUrl,
      targetDisplay.savedPath,
      'omniparser',
    )

    return {
      ...parseResult,
      annotatedImagePath,
      capture: {
        outputDir: captureResult.outputDir,
        createdAt: captureResult.createdAt,
        displayCount: captureResult.displayCount,
        targetDisplay,
      },
    }
  })

  ipcMain.handle('bridge:test-ppocr', async (_event, payload = {}) => {
    // PP-OCR 测试也固定抓取主屏，确保与 OmniParser 的对比基线一致。
    // 当前不再让服务回传标注图，只消费结构化 OCR 行。
    const { captureResult, targetDisplay } = await capturePrimaryDesktopForOmniParser(payload)
    const parseResult = await testPPOcrWithImage(targetDisplay.savedPath, payload)

    return {
      ...parseResult,
      capture: {
        outputDir: captureResult.outputDir,
        createdAt: captureResult.createdAt,
        displayCount: captureResult.displayCount,
        targetDisplay,
      },
    }
  })

  ipcMain.handle('bridge:show-corner-indicators', async () => {
    return showCornerIndicators()
  })

  ipcMain.handle('bridge:highlight-window', async (_event, payload = {}) => {
    return highlightWindow(payload)
  })

  ipcMain.handle('bridge:analyze-audio', async (_event, payload) => {
    const provider = normalizeProvider(payload?.provider)
    // 每次发送语音前都强制刷新窗口快照，确保传给 LLM 的是最新前台状态。
    const windows = await windowRegistry.refreshSnapshot()
    const matched = await parseAudioIntentWithWindows(payload.filePath, windows, { provider })

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

  ipcMain.handle('bridge:voice-handle-audio', async (_event, payload = {}) => {
    // 右 Alt 链路专用：本地 SenseVoice 转写 → 送入语音 FSM；云端 LLM 链路在这条链路里暂时禁用。
    await ensureManagedSenseVoiceServiceReady()
    const asr = await transcribeSenseVoiceAudio(payload.filePath, payload)
    const transcript = String(asr.text || '').trim()
    const routed = voiceRouter ? await voiceRouter.handleTranscript(transcript) : { handled: false, reason: 'router-missing' }
    return { transcript, asr, routed, state: voiceRouter?.getState() }
  })

  ipcMain.handle('bridge:voice-route-text', async (_event, payload = {}) => {
    // 调试入口：直接喂文本给 FSM（跳过 ASR），方便无麦调试。
    const transcript = String(payload?.transcript || '').trim()
    const routed = voiceRouter ? await voiceRouter.handleTranscript(transcript) : { handled: false, reason: 'router-missing' }
    return { transcript, routed, state: voiceRouter?.getState() }
  })

  ipcMain.handle('bridge:voice-reset', async () => {
    voiceRouter?.reset('manual')
    return { ok: true, state: voiceRouter?.getState() }
  })

  ipcMain.handle('bridge:transcribe-sensevoice', async (_event, payload = {}) => {
    // SenseVoice 本地识别与云端动作解析解耦，单独暴露成独立 IPC。
    await ensureManagedSenseVoiceServiceReady()
    return transcribeSenseVoiceAudio(payload.filePath, payload)
  })

  ipcMain.handle('bridge:match-transcript', async (_event, payload) => {
    const transcript = typeof payload === 'string' ? payload : payload?.transcript || ''
    const provider = normalizeProvider(payload?.provider)
    // 手动文本指令也复用最新窗口快照，避免和语音链路行为不一致。
    const windows = await windowRegistry.refreshSnapshot()
    return parseIntentWithWindows(transcript, windows, { provider })
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

  ipcMain.handle('bridge:get-window-automation', async (_event, payload = {}) => {
    return windowRegistry.getWindowAutomation(payload.handle, payload.options)
  })

  ipcMain.handle('bridge:capture-window', async (_event, handle) => {
    // 窗口截图独立于整屏截图链路，优先用于前台窗口的无遮挡抓图。
    return captureWindowImage(handle)
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
  stopManagedSenseVoiceService()
  stopManagedPPOcrService()
  shortcutManager.stop()
})
