import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import dotenv from 'dotenv'
import { app, BrowserWindow, dialog, ipcMain, nativeImage, screen } from 'electron'

import { AppSpatialMemoryStore } from './src/appSpatialMemoryStore.mjs'
import { captureDesktopScreenshots } from './src/desktopCapture.mjs'
import { MainDictationSession } from './src/dictationSession.mjs'
import { parseAudioIntentWithWindows, parseIntentWithWindows } from './src/intentParser.mjs'
import { probeOmniParser, testOmniParserWithImage } from './src/omniParserClient.mjs'
import { probePPOcr, testPPOcrWithImage } from './src/ppOcrClient.mjs'
import { runPowerShell } from './src/powershell.mjs'
import { testRapidOcrWithImage } from './src/rapidOcrClient.mjs'
import { listProviderStatuses, normalizeProvider } from './src/providerConfig.mjs'
import { probeSenseVoice, transcribeSenseVoiceAudio } from './src/senseVoiceClient.mjs'
import { GlobalShortcutManager } from './src/shortcutManager.mjs'
import {
  buildClickTargetFromSpaces,
  globalLogicalRectToRelative,
  mapFullScreenImageRect,
  mapWindowImageRect,
  relativeRectToWindowLocal,
} from './src/screenCoordinates.mjs'
import { createVoiceActionRouter, pickCandidates } from './src/voiceActionRouter.mjs'
import { WindowRegistry } from './src/windowRegistry.mjs'
import { executeActionPlan } from './src/windowsController.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const runtimeRoot = path.join(__dirname, '.runtime')
const runtimeUserData = path.join(runtimeRoot, 'user-data')
const runtimeSessionData = path.join(runtimeRoot, 'session-data')
const runtimeLogs = path.join(runtimeRoot, 'logs')
const runtimeScreenshots = path.join(runtimeRoot, 'desktop-captures')
const runtimeSpatialMemoryPath = path.join(runtimeRoot, 'app-spatial-memory.json')
const runtimeAppSettingsPath = path.join(runtimeRoot, 'app-settings.json')

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
let lastOverlayLogKey = ''
let indicatorWindows = []
let indicatorResetTimer = null
let focusIndicatorTimer = null
let focusIndicatorUpdateInFlight = false
let focusIndicatorKey = ''
let focusIndicatorRevision = 0
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
  profile: '',
  device: '',
  warmed: false,
}
let managedOmniParserProcess = null
let managedOmniParserState = {
  autostart: process.env.OMNIPARSER_AUTOSTART === 'true',
  status: 'idle',
  pid: null,
  lastError: '',
  profile: '',
  device: '',
}
let voiceRouter = null
let dictationSession = null
let nextDictationSessionId = 1
const spatialMemoryStore = new AppSpatialMemoryStore({
  filePath: runtimeSpatialMemoryPath,
})
const shortcutManager = new GlobalShortcutManager({
  configPath: path.join(runtimeRoot, 'shortcut-config.json'),
  onToggle: ({ triggeredLabel }) => {
    recordingByShortcut = !recordingByShortcut
    // 终端里直接打印快捷键切换，便于区分“没触发快捷键”和“触发后链路卡住”。
    console.log(`[shortcut] ${triggeredLabel} -> recording=${recordingByShortcut}`)
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
const IMAGE_JPEG_QUALITY = 92
const FOCUS_WINDOW_BORDER = 1
const FOCUS_WINDOW_LABEL = '当前窗口'
const FOCUS_WINDOW_POLL_MS = 400
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
const OMNIPARSER_DEFAULT_BASE_URL = process.env.OMNIPARSER_BASE_URL || 'http://127.0.0.1:8000'
const OMNIPARSER_CAPABILITY_ROOT = path.join(__dirname, 'capabilities', 'omniparser')
const OMNIPARSER_LOCAL_ROOT = path.join(OMNIPARSER_CAPABILITY_ROOT, '.local')
const OMNIPARSER_PYTHON_PATH = path.join(OMNIPARSER_LOCAL_ROOT, '.venv', 'Scripts', 'python.exe')
const OMNIPARSER_SERVER_PATH = path.join(OMNIPARSER_CAPABILITY_ROOT, 'service', 'server.py')
// 1x1 透明像素 PNG，用于 PP-OCR 首次调用预热 lru_cache 里的模型。
const WARMUP_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='
const VOICE_OCR_BACKENDS = ['ppocr', 'rapidocr', 'omniparser']
const VOICE_OCR_BACKEND_SET = new Set(VOICE_OCR_BACKENDS)
const DEFAULT_VOICE_OCR_PROFILE = 'omniparser-gpu'
// OCR 选择统一收口成 profile，避免 renderer/main/script 三处各自维护 backend/device。
const VOICE_OCR_PROFILE_TABLE = {
  'omniparser-gpu': {
    value: 'omniparser-gpu',
    backend: 'omniparser',
    serviceDevice: 'cuda',
    deviceLabel: 'GPU',
    label: 'OmniParser - GPU',
  },
  'omniparser-cpu': {
    value: 'omniparser-cpu',
    backend: 'omniparser',
    serviceDevice: 'cpu',
    deviceLabel: 'CPU',
    label: 'OmniParser - CPU',
  },
  'ppocr-gpu': {
    value: 'ppocr-gpu',
    backend: 'ppocr',
    serviceDevice: 'gpu',
    deviceLabel: 'GPU',
    label: 'PP-OCR - GPU',
  },
  'ppocr-cpu': {
    value: 'ppocr-cpu',
    backend: 'ppocr',
    serviceDevice: 'cpu',
    deviceLabel: 'CPU',
    label: 'PP-OCR - CPU',
  },
}
const VOICE_OCR_PROFILE_SET = new Set(Object.keys(VOICE_OCR_PROFILE_TABLE))
const SPATIAL_MEMORY_SEARCH_PADDING = 80
// 语音 OCR 前对截图做等比缩放以加速后端推理；返回 bbox 会按相同比例逆缩放回原图像素。
// 暂时固定 0.8（长高各保留 80%），后续按应用字体大小动态调整，详见 README TODO。
const VOICE_OCR_DOWNSCALE = 0.8
// 仅在需要排查缩放是否把小字挤没时打开：打开后会把传给 OCR 的缩放图落盘在原截图旁边。
const VOICE_OCR_DEBUG_SAVE_DOWNSCALED = /^(1|true|yes|on)$/i.test(String(process.env.VOICE_OCR_DEBUG_SAVE_DOWNSCALED || ''))
const DEFAULT_APP_SETTINGS = {
  activeMenu: 'developer',
  microphoneId: '',
  provider: 'qwen',
  senseVoiceEnabled: false,
  voiceOcrBackend: DEFAULT_VOICE_OCR_PROFILE,
  spatialMemoryEnabled: true,
  dictationEnabled: false,
  preferredLanguage: 'auto',
}

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

function normalizeVoiceOcrProfile(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (VOICE_OCR_PROFILE_SET.has(normalized)) return normalized
  if (normalized === 'ppocr') return 'ppocr-gpu'
  if (normalized === 'omniparser') return 'omniparser-gpu'
  return DEFAULT_VOICE_OCR_PROFILE
}

function resolveVoiceOcrConfig(value) {
  return VOICE_OCR_PROFILE_TABLE[normalizeVoiceOcrProfile(value)] || VOICE_OCR_PROFILE_TABLE[DEFAULT_VOICE_OCR_PROFILE]
}

function normalizeVoiceOcrBackend(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (VOICE_OCR_BACKEND_SET.has(normalized)) return normalized
  return resolveVoiceOcrConfig(value).backend
}

let currentVoiceOcrProfile = normalizeVoiceOcrProfile(process.env.VOICE_OCR_PROFILE || process.env.VOICE_OCR_BACKEND)

function normalizeAppSettings(input = {}) {
  // 设置持久化统一落到主进程 JSON，避免单纯依赖 Chromium Local Storage 被意外清空。
  return {
    activeMenu: String(input.activeMenu || DEFAULT_APP_SETTINGS.activeMenu),
    microphoneId: String(input.microphoneId || DEFAULT_APP_SETTINGS.microphoneId),
    provider: normalizeProvider(input.provider || DEFAULT_APP_SETTINGS.provider),
    senseVoiceEnabled: Boolean(input.senseVoiceEnabled),
    voiceOcrBackend: normalizeVoiceOcrProfile(input.voiceOcrBackend || DEFAULT_APP_SETTINGS.voiceOcrBackend),
    spatialMemoryEnabled: input.spatialMemoryEnabled !== false,
    dictationEnabled: Boolean(input.dictationEnabled),
    preferredLanguage: String(input.preferredLanguage || DEFAULT_APP_SETTINGS.preferredLanguage),
  }
}

async function loadAppSettings() {
  try {
    const text = await fsPromises.readFile(runtimeAppSettingsPath, 'utf8')
    const parsed = JSON.parse(text)
    const normalized = normalizeAppSettings(parsed)
    currentVoiceOcrProfile = normalized.voiceOcrBackend
    return normalized
  } catch {
    return { ...DEFAULT_APP_SETTINGS }
  }
}

async function saveAppSettings(partial = {}) {
  const current = await loadAppSettings()
  const next = normalizeAppSettings({ ...current, ...partial })
  await fsPromises.writeFile(runtimeAppSettingsPath, JSON.stringify(next, null, 2), 'utf8')
  currentVoiceOcrProfile = next.voiceOcrBackend
  return next
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function buildTimestampedPath(sourcePath, suffix, extension = 'jpg') {
  const parsedPath = path.parse(sourcePath)
  return path.join(parsedPath.dir, `${parsedPath.name}-${suffix}-${buildTimestampToken()}.${extension}`)
}

function isPointInBounds(x, y, bounds) {
  return Number.isFinite(x)
    && Number.isFinite(y)
    && bounds
    && x >= bounds.x
    && y >= bounds.y
    && x <= bounds.x + bounds.width
    && y <= bounds.y + bounds.height
}

// 点击点可能同时落在多个窗口区域里，优先选当前焦点窗口，再选面积更小的候选。
function findBestWindowForPoint(snapshot, x, y) {
  const items = Array.isArray(snapshot?.items) ? snapshot.items : []
  const focusedWindow = snapshot?.focusedWindow || null
  if (focusedWindow && isPointInBounds(x, y, focusedWindow.bounds)) {
    return focusedWindow
  }

  const hits = items.filter(item => isPointInBounds(x, y, item.bounds))
  hits.sort((left, right) => {
    const leftArea = (left.bounds?.width || 0) * (left.bounds?.height || 0)
    const rightArea = (right.bounds?.width || 0) * (right.bounds?.height || 0)
    return leftArea - rightArea
  })
  return hits[0] || null
}

function buildScreenRectFromCandidate(target) {
  const bbox = Array.isArray(target?.bbox) ? target.bbox : []
  if (bbox.length < 4 || !Number.isFinite(target?.clickX) || !Number.isFinite(target?.clickY)) {
    return null
  }

  const [x1, y1, x2, y2] = bbox
  const width = Math.max(1, x2 - x1)
  const height = Math.max(1, y2 - y1)
  const left = Math.round(target.clickX - width / 2)
  const top = Math.round(target.clickY - height / 2)
  return { left, top, width, height }
}

// 空间记忆 / 高亮 / 点击之间的坐标换算统一在 src/screenCoordinates.mjs，这里只保留业务语义的薄封装。

// 语音链路前置：内存里缩放截图，拿到 PNG buffer + 精确缩放系数。
// 关键约定：调用方拿到的是“OCR 喂进去的图”的尺寸；unscaleOcrLines 里反向还原成原图坐标。
function prepareDownscaledOcrImage(imagePath, sourceSize) {
  const image = nativeImage.createFromPath(imagePath)
  if (image.isEmpty()) {
    throw new Error(`无法读取截图文件: ${imagePath}`)
  }
  const originalSize = image.getSize()
  const originalWidth = sourceSize?.width || originalSize.width
  const originalHeight = sourceSize?.height || originalSize.height
  const targetWidth = Math.max(1, Math.round(originalWidth * VOICE_OCR_DOWNSCALE))
  const targetHeight = Math.max(1, Math.round(originalHeight * VOICE_OCR_DOWNSCALE))
  const resized = image.resize({ width: targetWidth, height: targetHeight, quality: 'best' })
  const actual = resized.getSize()
  // PNG 避免二次 JPEG 伪影，对小字更友好。
  const buffer = resized.toPNG()
  return {
    buffer,
    originalWidth,
    originalHeight,
    width: actual.width,
    height: actual.height,
    // 注意用“实测宽高”反推系数，避免 resize 取整带来的 1~2px 偏差累积到点击落点。
    scaleX: actual.width / Math.max(1, originalWidth),
    scaleY: actual.height / Math.max(1, originalHeight),
  }
}

// 调试开关打开时把喂进 OCR 的缩放图落盘在原截图旁边，便于肉眼复核字号是否还能被识别。
async function maybeSaveDebugDownscaledImage(imagePath, buffer) {
  if (!VOICE_OCR_DEBUG_SAVE_DOWNSCALED) return null
  const parsed = path.parse(imagePath)
  const debugPath = path.join(parsed.dir, `${parsed.name}-ocr-scaled.png`)
  try {
    await fsPromises.writeFile(debugPath, buffer)
    return debugPath
  } catch (error) {
    console.warn(`[voice] save downscaled debug image failed: ${error.message}`)
    return null
  }
}

// OCR 返回的 bbox / polygon 都在“缩放后小图”像素空间；这里乘回去让下游永远只看到原图坐标。
function unscaleOcrLines(lines, scaleX, scaleY) {
  if (!Array.isArray(lines) || lines.length === 0) return lines || []
  const inverseX = 1 / Math.max(scaleX, Number.EPSILON)
  const inverseY = 1 / Math.max(scaleY, Number.EPSILON)
  return lines.map((line) => {
    if (!line) return line
    const next = { ...line }
    if (Array.isArray(line.bbox) && line.bbox.length === 4) {
      next.bbox = [
        Math.round(line.bbox[0] * inverseX),
        Math.round(line.bbox[1] * inverseY),
        Math.round(line.bbox[2] * inverseX),
        Math.round(line.bbox[3] * inverseY),
      ]
    }
    if (Array.isArray(line.polygon)) {
      next.polygon = line.polygon.map(point => Array.isArray(point)
        ? [Math.round(point[0] * inverseX), Math.round(point[1] * inverseY)]
        : point,
      )
    }
    return next
  })
}

async function runVoiceOcrWithImage(imagePath, backend, options = {}) {
  const normalizedBackend = normalizeVoiceOcrBackend(backend)
  const profile = normalizeVoiceOcrProfile(backend)
  const ocrStartAt = Date.now()

  // 所有后端统一先做内存缩放；后端 client 接 options.imageBuffer 就不再读盘。
  const scaled = prepareDownscaledOcrImage(imagePath)
  const debugPath = await maybeSaveDebugDownscaledImage(imagePath, scaled.buffer)
  const backendOptions = { ...options, imageBuffer: scaled.buffer }
  const scaleLog = `scale=${VOICE_OCR_DOWNSCALE} ${scaled.originalWidth}x${scaled.originalHeight}->${scaled.width}x${scaled.height}${debugPath ? ` debug=${debugPath}` : ''}`

  if (normalizedBackend === 'omniparser') {
    await ensureManagedOmniParserServiceReady({ profile })
    const result = await testOmniParserWithImage(imagePath, backendOptions)
    const ocrLines = unscaleOcrLines(result.ocrLines, scaled.scaleX, scaled.scaleY)
    console.log(`[${new Date().toISOString()}] [voice] omniparser completed in ${Date.now() - ocrStartAt}ms: lines=${result.lineCount || 0} elements=${result.elementCount || 0} ${scaleLog}`)
    return { ...result, ocrLines }
  }

  if (normalizedBackend === 'rapidocr') {
    const result = await testRapidOcrWithImage(imagePath, backendOptions)
    const ocrLines = unscaleOcrLines(result.ocrLines, scaled.scaleX, scaled.scaleY)
    console.log(`[${new Date().toISOString()}] [voice] rapidocr completed in ${Date.now() - ocrStartAt}ms: lines=${result.lineCount || 0} ${scaleLog}`)
    return { ...result, ocrLines }
  }

  await ensureManagedPPOcrServiceReady({ profile })
  const result = await testPPOcrWithImage(imagePath, backendOptions)
  const ocrLines = unscaleOcrLines(result.ocrLines, scaled.scaleX, scaled.scaleY)
  console.log(`[${new Date().toISOString()}] [voice] ppocr completed in ${Date.now() - ocrStartAt}ms: lines=${result.lineCount || 0} ${scaleLog}`)
  return { ...result, ocrLines }
}

// 直接用 Electron 原生图片裁剪局部区域，避免额外引入图像处理依赖。
async function cropImageToFile(sourcePath, cropRect, outputPath) {
  const image = nativeImage.createFromPath(sourcePath)
  if (image.isEmpty()) {
    throw new Error(`无法读取截图文件: ${sourcePath}`)
  }

  const size = image.getSize()
  const x = clamp(Math.round(cropRect.x || 0), 0, Math.max(0, size.width - 1))
  const y = clamp(Math.round(cropRect.y || 0), 0, Math.max(0, size.height - 1))
  const width = clamp(Math.round(cropRect.width || 0), 1, Math.max(1, size.width - x))
  const height = clamp(Math.round(cropRect.height || 0), 1, Math.max(1, size.height - y))
  const cropped = image.crop({ x, y, width, height })
  // 中间裁剪图也统一写成 JPG，避免 OCR 链路混用多种本地格式。
  await fsPromises.writeFile(outputPath, cropped.toJPEG(IMAGE_JPEG_QUALITY))
  return { x, y, width, height, imageWidth: size.width, imageHeight: size.height, outputPath }
}

function buildSearchRectFromMemory(memoryEntry, windowItem) {
  const bounds = windowItem?.bounds
  const currentRect = relativeRectToWindowLocal(memoryEntry?.relativeRect, bounds, { minSize: 24 })
  if (!currentRect) return null

  const paddingX = Math.max(SPATIAL_MEMORY_SEARCH_PADDING, currentRect.width * 0.9)
  const paddingY = Math.max(SPATIAL_MEMORY_SEARCH_PADDING, currentRect.height * 0.9)

  return {
    x: clamp(currentRect.x - paddingX, 0, Math.max(0, bounds.width - 1)),
    y: clamp(currentRect.y - paddingY, 0, Math.max(0, bounds.height - 1)),
    width: clamp(currentRect.width + paddingX * 2, 1, bounds.width),
    height: clamp(currentRect.height + paddingY * 2, 1, bounds.height),
  }
}

async function clickWindowLocalPoint(handle, localX, localY) {
  const safeHandle = String(handle || '').replace(/'/g, '')
  const offsetX = Math.round(Number(localX) || 0)
  const offsetY = Math.round(Number(localY) || 0)
  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public struct RECT {
  public int Left;
  public int Top;
  public int Right;
  public int Bottom;
}
public static class BridgeWindowClick {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
$hWnd = [IntPtr][Int64]'${safeHandle}'
if ($hWnd -eq [IntPtr]::Zero) { throw "Invalid window handle" }
[BridgeWindowClick]::SetProcessDPIAware() | Out-Null
$rect = New-Object RECT
if (-not [BridgeWindowClick]::GetWindowRect($hWnd, [ref]$rect)) { throw "GetWindowRect failed" }
$clickX = [int]($rect.Left + ${offsetX})
$clickY = [int]($rect.Top + ${offsetY})
[BridgeWindowClick]::SetCursorPos($clickX, $clickY) | Out-Null
Start-Sleep -Milliseconds 40
[BridgeWindowClick]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
[BridgeWindowClick]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
[PSCustomObject]@{
  ok = $true
  handle = '${safeHandle}'
  clickX = $clickX
  clickY = $clickY
  localX = ${offsetX}
  localY = ${offsetY}
} | ConvertTo-Json -Depth 3
`

  const result = await runPowerShell(script)
  return result.stdout ? JSON.parse(result.stdout) : { ok: true }
}

async function tryResolveCandidateFromSpatialMemory({ keyword, backend, logger }) {
  const snapshot = await windowRegistry.refreshSnapshot()
  const focusedWindow = snapshot.focusedWindow
  if (!focusedWindow) {
    logger?.(`[voice] spatial-memory miss: no focused window`)
    return null
  }

  const memoryEntry = spatialMemoryStore.getMemory(focusedWindow, keyword)
  if (!memoryEntry) {
    logger?.(`[voice] spatial-memory miss: no key for ${focusedWindow.appName || 'unknown'} / ${focusedWindow.title}`)
    return null
  }

  const searchRect = buildSearchRectFromMemory(memoryEntry, focusedWindow)
  if (!searchRect) {
    logger?.('[voice] spatial-memory miss: invalid remembered rect')
    return null
  }

  const capturedWindow = await captureWindowImage(focusedWindow.handle)
  const cropOutputPath = buildTimestampedPath(capturedWindow.imagePath, 'memory-crop')
  const imageSize = { width: capturedWindow.width, height: capturedWindow.height }
  const scaleX = imageSize.width / Math.max(1, focusedWindow.bounds.width)
  const scaleY = imageSize.height / Math.max(1, focusedWindow.bounds.height)
  // 记忆里保存的是“相对窗口位置”，先换算到当前窗口物理像素，再截一个更小的搜索区域。
  const cropRect = await cropImageToFile(capturedWindow.imagePath, {
    x: searchRect.x * scaleX,
    y: searchRect.y * scaleY,
    width: searchRect.width * scaleX,
    height: searchRect.height * scaleY,
  }, cropOutputPath)

  const parseResult = await runVoiceOcrWithImage(cropRect.outputPath, backend, { timeoutMs: 60000 })
  const picks = pickCandidates(parseResult.ocrLines, keyword, 3)
  if (picks.length === 0) {
    logger?.(`[voice] spatial-memory miss: crop OCR no candidate for "${keyword}"`)
    return null
  }

  const target = picks[0]
  const [x1, y1, x2, y2] = target.bbox
  // crop 内 OCR 的 bbox 是 crop 物理像素，加上 cropRect 的 offset 就变回窗口截图物理像素。
  // 后面交给 mapWindowImageRect 统一换算到各个空间。
  const windowPhysicalRect = {
    x: cropRect.x + x1,
    y: cropRect.y + y1,
    width: Math.max(1, x2 - x1),
    height: Math.max(1, y2 - y1),
  }
  const display = screen.getDisplayMatching(focusedWindow.bounds)
  const spaces = mapWindowImageRect({
    rect: windowPhysicalRect,
    windowBounds: focusedWindow.bounds,
    imageSize,
    displayBounds: display?.bounds,
  })
  const clickTarget = buildClickTargetFromSpaces(spaces, { windowHandle: focusedWindow.handle })

  logger?.(`[voice] spatial-memory hit: ${focusedWindow.appName || 'unknown'} / ${focusedWindow.title} -> logical=(${clickTarget.clickX},${clickTarget.clickY}) localPhysical=(${clickTarget.localClickX},${clickTarget.localClickY})`)
  return {
    index: 1,
    text: target.text,
    bbox: [
      Math.round(spaces.globalLogical.left),
      Math.round(spaces.globalLogical.top),
      Math.round(spaces.globalLogical.left + spaces.globalLogical.width),
      Math.round(spaces.globalLogical.top + spaces.globalLogical.height),
    ],
    ...clickTarget,
    source: 'spatial-memory',
    window: focusedWindow,
    logicalRect: spaces.globalLogical,
  }
}

async function rememberSpatialSelection({ keyword, target, backend, mode, logger }) {
  if (!keyword || !target) return null

  await new Promise(resolve => setTimeout(resolve, 180))
  const snapshot = await windowRegistry.refreshSnapshot()
  // 点击完成后重新读取前台窗口，再把按钮位置折算成“相对窗口坐标”保存。
  const hostWindow = findBestWindowForPoint(
    snapshot,
    target.clickX,
    target.clickY,
  )
  if (!hostWindow?.bounds?.width || !hostWindow?.bounds?.height) {
    logger?.('[voice] spatial-memory skip: host window not found')
    return null
  }

  let relativeRect = null

  try {
    // 点击后用“当前窗口截图 + 同关键词 OCR”重新定位，避免整屏坐标和窗口坐标混算。
    const capturedWindow = await captureWindowImage(hostWindow.handle)
    const windowOcr = await runVoiceOcrWithImage(capturedWindow.imagePath, backend, { timeoutMs: 60000 })
    const windowPicks = pickCandidates(windowOcr.ocrLines, keyword, 3)
    if (windowPicks.length > 0) {
      const [x1, y1, x2, y2] = windowPicks[0].bbox
      const spaces = mapWindowImageRect({
        rect: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 },
        windowBounds: hostWindow.bounds,
        imageSize: { width: capturedWindow.width, height: capturedWindow.height },
      })
      relativeRect = globalLogicalRectToRelative(spaces?.globalLogical, hostWindow.bounds)
      if (relativeRect) {
        logger?.('[voice] spatial-memory save source: window-ocr')
      }
    }
  } catch (error) {
    logger?.(`[voice] spatial-memory window-ocr failed: ${error.message || error}`)
  }

  if (!relativeRect) {
    // 窗口内 OCR 失败时，再回退到之前的逻辑坐标换算。
    relativeRect = globalLogicalRectToRelative(target.logicalRect || null, hostWindow.bounds)
    if (relativeRect) {
      logger?.('[voice] spatial-memory save source: logical-rect fallback')
    }
  }

  if (!relativeRect) {
    const screenRect = buildScreenRectFromCandidate(target)
    if (!screenRect) {
      logger?.('[voice] spatial-memory skip: candidate rect unavailable')
      return null
    }
    logger?.('[voice] spatial-memory save source: screen-rect fallback')
    relativeRect = globalLogicalRectToRelative({
      left: screenRect.left,
      top: screenRect.top,
      width: screenRect.width,
      height: screenRect.height,
    }, hostWindow.bounds)
    if (!relativeRect) {
      logger?.('[voice] spatial-memory skip: relative rect conversion failed')
      return null
    }
  }

  const remembered = await spatialMemoryStore.rememberSelection({
    window: hostWindow,
    keyword,
    labelText: target.text,
    backend,
    mode,
    relativeRect,
  })
  logger?.(`[voice] spatial-memory saved: ${hostWindow.appName || 'unknown'} / ${hostWindow.title} / ${keyword} -> x=${relativeRect.x.toFixed(3)} y=${relativeRect.y.toFixed(3)} w=${relativeRect.width.toFixed(3)} h=${relativeRect.height.toFixed(3)}`)
  return remembered
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

// 指示层常驻存在，所有高亮都只通过更新 DOM 内容完成。
async function pushIndicatorItems(rectGroups = []) {
  const windows = await ensureIndicatorWindows()
  const groupsByDisplayId = new Map(rectGroups.map((item) => [item.displayId, item.items]))

  for (const item of windows) {
    const items = groupsByDisplayId.get(item.display.id) || []
    await item.window.webContents.executeJavaScript(
      `window.renderIndicators(${JSON.stringify({ items })})`,
      true,
    )
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
      .indicator--focus-window {
        border: ${FOCUS_WINDOW_BORDER}px solid #facc15;
        box-shadow: 0 0 0 1px rgba(250, 204, 21, 0.2);
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
      .indicator__label {
        position: absolute;
        left: 50%;
        bottom: 0;
        padding: 3px 10px 4px;
        border: 1px solid #facc15;
        border-top: 0;
        border-radius: 0 0 10px 10px;
        background: #facc15;
        color: #222;
        font: 600 12px/1.1 "Segoe UI", system-ui, sans-serif;
        white-space: nowrap;
        transform: translate(-50%, calc(100% - 1px));
        box-shadow: 0 4px 10px rgba(0,0,0,0.25);
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
          const type = item.type === 'window'
            ? 'window'
            : item.type === 'focus-window'
              ? 'focus-window'
              : item.type === 'numbered'
                ? 'numbered'
                : 'corner'
          const badge = (type === 'numbered' && item.label != null)
            ? '<div class="indicator__badge indicator__badge--' + (item.badgeSide === 'left' ? 'left' : 'right') + '">' + String(item.label) + '</div>'
            : ''
          const title = (type === 'focus-window' && item.label)
            ? '<div class="indicator__label">' + String(item.label) + '</div>'
            : ''
          return '<div class="indicator indicator--' + type + '" style="left:' + left + 'px;top:' + top + 'px;width:' + width + 'px;height:' + height + 'px;">' + badge + title + '</div>'
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

function buildFocusWindowIndicatorRects(bounds, displays) {
  const normalizedBounds = normalizeRectangle(bounds)
  const centerDisplay = screen.getDisplayNearestPoint({
    x: normalizedBounds.x + normalizedBounds.width / 2,
    y: normalizedBounds.y + normalizedBounds.height / 2,
  })

  return displays.map((display) => {
    const sourceBounds = getDisplaySourceBounds(display)
    const left = Math.max(normalizedBounds.x, sourceBounds.x)
    const top = Math.max(normalizedBounds.y, sourceBounds.y)
    const right = Math.min(normalizedBounds.x + normalizedBounds.width, sourceBounds.x + sourceBounds.width)
    const bottom = Math.min(normalizedBounds.y + normalizedBounds.height, sourceBounds.y + sourceBounds.height)

    if (right <= left || bottom <= top) {
      return { displayId: display.id, items: [] }
    }

    return {
      displayId: display.id,
      items: [
        {
          type: 'focus-window',
          left: left - sourceBounds.x,
          top: top - sourceBounds.y,
          width: right - left,
          height: bottom - top,
          label: display.id === centerDisplay.id ? FOCUS_WINDOW_LABEL : '',
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
  await pushIndicatorItems(rectGroups)

  indicatorResetTimer = setTimeout(() => {
    void clearIndicatorWindows()
  }, durationMs)
}

async function rebuildIndicatorWindows() {
  // 显示器布局变化后立即后台重建，避免下一次点击才触发初始化延迟。
  disposeIndicatorWindows()
  await ensureIndicatorWindows()
}

function shouldShowFocusIndicatorForOverlay(payload = {}) {
  if (payload?.status !== 'listening') return false
  const title = String(payload?.title || '')
  const subtitle = String(payload?.subtitle || '')
  return title.includes('连续听写') || subtitle.includes('再按') || subtitle.includes('快捷键')
}

// 轮询聚焦窗口，并把结果同步到透明高亮层。
async function refreshFocusedWindowIndicator() {
  if (focusIndicatorUpdateInFlight) return
  const revision = focusIndicatorRevision
  focusIndicatorUpdateInFlight = true
  try {
    const snapshot = await windowRegistry.refreshSnapshot()
    // 停止收音后，如果有旧请求回流，直接丢弃，避免高亮被重新画出来。
    if (revision !== focusIndicatorRevision) return
    const focusedWindow = snapshot.focusedWindow
    if (!focusedWindow?.bounds?.width || !focusedWindow?.bounds?.height) {
      if (focusIndicatorKey) {
        focusIndicatorKey = ''
        await clearIndicatorWindows()
      }
      return
    }

    const nextKey = JSON.stringify({
      handle: focusedWindow.handle,
      x: focusedWindow.bounds.x,
      y: focusedWindow.bounds.y,
      width: focusedWindow.bounds.width,
      height: focusedWindow.bounds.height,
      title: focusedWindow.title,
    })
    if (nextKey === focusIndicatorKey) return

    focusIndicatorKey = nextKey
    const rectGroups = buildFocusWindowIndicatorRects(focusedWindow.bounds, screen.getAllDisplays())
    if (revision !== focusIndicatorRevision) return
    await pushIndicatorItems(rectGroups)
  } finally {
    focusIndicatorUpdateInFlight = false
  }
}

// 进入连续听写时启动窗口轮询，让高亮框跟随焦点窗口移动。
function startFocusedWindowIndicator() {
  if (focusIndicatorTimer) return
  focusIndicatorRevision += 1
  void refreshFocusedWindowIndicator()
  focusIndicatorTimer = setInterval(() => {
    void refreshFocusedWindowIndicator()
  }, FOCUS_WINDOW_POLL_MS)
}

// 退出连续听写时立刻停止轮询，并清空所有窗口高亮。
async function stopFocusedWindowIndicator() {
  focusIndicatorRevision += 1
  if (focusIndicatorTimer) {
    clearInterval(focusIndicatorTimer)
    focusIndicatorTimer = null
  }
  focusIndicatorKey = ''
  await clearIndicatorWindows()
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

async function waitForProcessExit(processHandle, timeoutMs = 1500) {
  if (!processHandle || processHandle.killed) return
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs)
    processHandle.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
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

async function waitForManagedPPOcrReady(profile = currentVoiceOcrProfile) {
  const resolved = resolveVoiceOcrConfig(profile)
  for (let index = 0; index < 60; index += 1) {
    try {
      const probe = await probePPOcr({ timeoutMs: 1000 })
      managedPPOcrState = {
        ...managedPPOcrState,
        status: 'ready',
        pid: managedPPOcrProcess?.pid || managedPPOcrState.pid,
        lastError: '',
        profile: normalizeVoiceOcrProfile(profile),
        device: probe?.payload?.device || resolved.serviceDevice,
      }
      return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  managedPPOcrState = {
    ...managedPPOcrState,
    status: 'starting',
    profile: normalizeVoiceOcrProfile(profile),
    device: resolved.serviceDevice,
    lastError: 'PP-OCR 服务启动中，但探活尚未完成。',
  }
}

async function startManagedPPOcrService(options = {}) {
  const manual = Boolean(options.manual)
  const profile = normalizeVoiceOcrProfile(options.profile || currentVoiceOcrProfile)
  const resolved = resolveVoiceOcrConfig(profile)
  const baseUrl = parsePPOcrBaseUrl()
  managedPPOcrState = {
    ...managedPPOcrState,
    autostart: process.env.PPOCR_AUTOSTART !== 'false',
    profile,
    device: resolved.serviceDevice,
  }

  if (resolved.backend !== 'ppocr') {
    managedPPOcrState = { ...managedPPOcrState, status: 'idle', pid: null, warmed: false }
    return
  }
  if (!manual && !managedPPOcrState.autostart) {
    managedPPOcrState = { ...managedPPOcrState, status: 'disabled', lastError: '' }
    return
  }
  if (!isLocalPPOcrUrl(baseUrl)) {
    managedPPOcrState = { ...managedPPOcrState, status: 'external', lastError: 'PPOCR_BASE_URL 指向非本机地址，跳过自动启动。' }
    return
  }
  if (managedPPOcrProcess && !managedPPOcrProcess.killed) {
    if (managedPPOcrState.device === resolved.serviceDevice && managedPPOcrState.profile === profile) {
      return
    }
    const previousProcess = managedPPOcrProcess
    stopManagedPPOcrService()
    await waitForProcessExit(previousProcess)
  }
  try {
    const probe = await probePPOcr({ timeoutMs: 800 })
    managedPPOcrState = {
      ...managedPPOcrState,
      status: 'external',
      lastError: '',
      device: probe?.payload?.device || resolved.serviceDevice,
    }
    return
  } catch {}
  if (!fs.existsSync(PPOCR_PYTHON_PATH) || !fs.existsSync(PPOCR_SERVER_PATH)) {
    managedPPOcrState = { ...managedPPOcrState, status: 'missing', lastError: 'PP-OCR 本地部署不存在，请先运行 npm run capability:ppocr:setup。' }
    return
  }

  fs.mkdirSync(path.join(PPOCR_LOCAL_ROOT, 'cache'), { recursive: true })
  const stdoutLog = fs.createWriteStream(path.join(runtimeLogs, 'ppocr.managed.stdout.log'), { flags: 'a' })
  const stderrLog = fs.createWriteStream(path.join(runtimeLogs, 'ppocr.managed.stderr.log'), { flags: 'a' })
  const host = baseUrl.hostname === 'localhost' ? '127.0.0.1' : baseUrl.hostname
  const port = baseUrl.port || '8020'

  managedPPOcrProcess = spawn(PPOCR_PYTHON_PATH, [
    PPOCR_SERVER_PATH,
    '--host', host,
    '--port', port,
    '--device', resolved.serviceDevice,
  ], {
    cwd: __dirname,
    env: { ...process.env },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  managedPPOcrProcess.stdout.pipe(stdoutLog)
  managedPPOcrProcess.stderr.pipe(stderrLog)
  managedPPOcrState = {
    ...managedPPOcrState,
    status: 'starting',
    pid: managedPPOcrProcess.pid,
    lastError: '',
    profile,
    device: resolved.serviceDevice,
    warmed: false,
  }

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

  waitForManagedPPOcrReady(profile)
    .then(() => { void warmupPPOcr() })
    .catch((error) => {
      managedPPOcrState = { ...managedPPOcrState, status: 'error', lastError: String(error.message || error) }
    })
}

async function ensureManagedPPOcrServiceReady(options = {}) {
  const profile = normalizeVoiceOcrProfile(options.profile || currentVoiceOcrProfile)
  const resolved = resolveVoiceOcrConfig(profile)
  if (await isPPOcrReachable(1000) && managedPPOcrState.profile === profile && managedPPOcrState.device === resolved.serviceDevice) return
  await startManagedPPOcrService({ ...options, profile })
  if (managedPPOcrState.status === 'starting') {
    await waitForManagedPPOcrReady(profile)
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
    managedPPOcrState = { ...managedPPOcrState, status: 'stopped', pid: null, lastError: '', warmed: false }
  }
  managedPPOcrProcess = null
}

function parseOmniParserBaseUrl() {
  try { return new URL(OMNIPARSER_DEFAULT_BASE_URL) } catch { return new URL('http://127.0.0.1:8000') }
}

function isLocalOmniParserUrl(url) {
  return ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
}

async function isOmniParserReachable(timeoutMs = 1000) {
  try {
    await probeOmniParser({ timeoutMs })
    return true
  } catch { return false }
}

function buildOmniParserEnv() {
  const cacheRoot = path.join(OMNIPARSER_LOCAL_ROOT, 'cache')
  const easyOcrRoot = path.join(cacheRoot, 'easyocr')
  const hfRoot = path.join(cacheRoot, 'hf')
  const tempRoot = path.join(cacheRoot, 'tmp')
  return {
    ...process.env,
    PIP_CACHE_DIR: path.join(cacheRoot, 'pip'),
    HF_HOME: hfRoot,
    HUGGINGFACE_HUB_CACHE: path.join(hfRoot, 'hub'),
    EASYOCR_MODULE_PATH: easyOcrRoot,
    TEMP: tempRoot,
    TMP: tempRoot,
  }
}

async function waitForManagedOmniParserReady(profile = currentVoiceOcrProfile) {
  const resolved = resolveVoiceOcrConfig(profile)
  for (let index = 0; index < 60; index += 1) {
    try {
      const probe = await probeOmniParser({ timeoutMs: 1000 })
      managedOmniParserState = {
        ...managedOmniParserState,
        status: 'ready',
        pid: managedOmniParserProcess?.pid || managedOmniParserState.pid,
        lastError: '',
        profile: normalizeVoiceOcrProfile(profile),
        device: probe?.payload?.device || resolved.serviceDevice,
      }
      return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  managedOmniParserState = {
    ...managedOmniParserState,
    status: 'starting',
    profile: normalizeVoiceOcrProfile(profile),
    device: resolved.serviceDevice,
    lastError: 'OmniParser 服务启动中，但探活尚未完成。',
  }
}

// OmniParser 托管启动与 PP-OCR 同级，统一由 Electron 主进程管理生命周期。
async function startManagedOmniParserService(options = {}) {
  const manual = Boolean(options.manual)
  const profile = normalizeVoiceOcrProfile(options.profile || currentVoiceOcrProfile)
  const resolved = resolveVoiceOcrConfig(profile)
  const baseUrl = parseOmniParserBaseUrl()
  managedOmniParserState = {
    ...managedOmniParserState,
    autostart: process.env.OMNIPARSER_AUTOSTART === 'true',
    profile,
    device: resolved.serviceDevice,
  }

  if (resolved.backend !== 'omniparser') {
    managedOmniParserState = { ...managedOmniParserState, status: 'idle', pid: null }
    return
  }
  if (!manual && !managedOmniParserState.autostart) {
    managedOmniParserState = { ...managedOmniParserState, status: 'disabled', lastError: '' }
    return
  }
  if (!isLocalOmniParserUrl(baseUrl)) {
    managedOmniParserState = { ...managedOmniParserState, status: 'external', lastError: 'OMNIPARSER_BASE_URL 指向非本机地址，跳过托管启动。' }
    return
  }
  if (managedOmniParserProcess && !managedOmniParserProcess.killed) {
    if (managedOmniParserState.device === resolved.serviceDevice && managedOmniParserState.profile === profile) {
      return
    }
    const previousProcess = managedOmniParserProcess
    stopManagedOmniParserService()
    await waitForProcessExit(previousProcess)
  }
  try {
    const probe = await probeOmniParser({ timeoutMs: 800 })
    managedOmniParserState = {
      ...managedOmniParserState,
      status: 'external',
      lastError: '',
      device: probe?.payload?.device || resolved.serviceDevice,
    }
    return
  } catch {}
  if (!fs.existsSync(OMNIPARSER_PYTHON_PATH) || !fs.existsSync(OMNIPARSER_SERVER_PATH)) {
    managedOmniParserState = { ...managedOmniParserState, status: 'missing', lastError: 'OmniParser 本地部署不存在，请先运行 npm run capability:omniparser:setup。' }
    return
  }

  const cacheRoot = path.join(OMNIPARSER_LOCAL_ROOT, 'cache')
  fs.mkdirSync(path.join(cacheRoot, 'pip'), { recursive: true })
  fs.mkdirSync(path.join(cacheRoot, 'hf', 'hub'), { recursive: true })
  fs.mkdirSync(path.join(cacheRoot, 'easyocr'), { recursive: true })
  fs.mkdirSync(path.join(cacheRoot, 'tmp'), { recursive: true })
  const stdoutLog = fs.createWriteStream(path.join(runtimeLogs, 'omniparser.managed.stdout.log'), { flags: 'a' })
  const stderrLog = fs.createWriteStream(path.join(runtimeLogs, 'omniparser.managed.stderr.log'), { flags: 'a' })
  const host = baseUrl.hostname === 'localhost' ? '127.0.0.1' : baseUrl.hostname
  const port = baseUrl.port || '8000'

  managedOmniParserProcess = spawn(OMNIPARSER_PYTHON_PATH, [
    OMNIPARSER_SERVER_PATH,
    '--host', host,
    '--port', port,
    '--device', resolved.serviceDevice,
  ], {
    cwd: __dirname,
    env: buildOmniParserEnv(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  managedOmniParserProcess.stdout.pipe(stdoutLog)
  managedOmniParserProcess.stderr.pipe(stderrLog)
  managedOmniParserState = {
    ...managedOmniParserState,
    status: 'starting',
    pid: managedOmniParserProcess.pid,
    lastError: '',
    profile,
    device: resolved.serviceDevice,
  }

  managedOmniParserProcess.on('error', (error) => {
    managedOmniParserState = { ...managedOmniParserState, status: 'error', pid: null, lastError: String(error.message || error) }
  })
  managedOmniParserProcess.on('exit', (code, signal) => {
    if (managedOmniParserProcess) {
      managedOmniParserState = {
        ...managedOmniParserState,
        status: code === 0 ? 'stopped' : 'error',
        pid: null,
        lastError: code === 0 ? '' : `OmniParser 服务已退出，code=${code}, signal=${signal || ''}`,
      }
    }
    managedOmniParserProcess = null
  })

  waitForManagedOmniParserReady(profile).catch((error) => {
    managedOmniParserState = { ...managedOmniParserState, status: 'error', lastError: String(error.message || error) }
  })
}

async function ensureManagedOmniParserServiceReady(options = {}) {
  const profile = normalizeVoiceOcrProfile(options.profile || currentVoiceOcrProfile)
  const resolved = resolveVoiceOcrConfig(profile)
  if (await isOmniParserReachable(1000) && managedOmniParserState.profile === profile && managedOmniParserState.device === resolved.serviceDevice) return
  await startManagedOmniParserService({ ...options, manual: true, profile })
  if (managedOmniParserState.status === 'starting') {
    await waitForManagedOmniParserReady(profile)
  }
}

function stopManagedOmniParserService() {
  if (managedOmniParserProcess && !managedOmniParserProcess.killed) {
    managedOmniParserProcess.kill()
    managedOmniParserState = { ...managedOmniParserState, status: 'stopped', pid: null, lastError: '' }
  }
  managedOmniParserProcess = null
}

// 根据当前所选 OCR profile 切换托管服务；同后端切 device 时也会重启对应进程。
async function applySelectedOcrService(selection) {
  const profile = normalizeVoiceOcrProfile(selection)
  const selected = resolveVoiceOcrConfig(profile)
  currentVoiceOcrProfile = profile
  if (selected.backend === 'omniparser') {
    stopManagedPPOcrService()
    await startManagedOmniParserService({ manual: true, profile })
  } else if (selected.backend === 'ppocr') {
    stopManagedOmniParserService()
    await startManagedPPOcrService({ manual: true, profile })
  } else {
    stopManagedOmniParserService()
    stopManagedPPOcrService()
  }

  return {
    profile,
    backend: selected.backend,
    omniparser: managedOmniParserState,
    ppocr: managedPPOcrState,
  }
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
  const fileName = `window-${target.shortId.toLowerCase()}-${buildTimestampToken()}.jpg`
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
  const outputPath = path.join(parsedPath.dir, `${parsedPath.name}-${suffix}.jpg`)
  // 服务端返回的标注图可能是 PNG，这里统一转成 JPG 落盘，保持本地产物一致。
  const image = nativeImage.createFromDataURL(imageDataUrl)
  if (image.isEmpty()) {
    throw new Error('视觉能力标注图解码失败，无法保存到本地。')
  }
  await fsPromises.writeFile(outputPath, image.toJPEG(IMAGE_JPEG_QUALITY))
  return outputPath
}

// 语音点击链路统一从这里切换 OCR 后端，统一吐出 mapImageRectToSpaces，路由侧不再关心坐标空间。
async function captureAndOcrPrimaryDisplay(options = {}) {
  const backend = normalizeVoiceOcrBackend(options.backend)
  const captureStartAt = Date.now()
  const captureResult = await captureDesktopScreenshots({
    outputDir: runtimeScreenshots,
    compressed: false,
    maxHeight: 9999,
  })
  const item = captureResult.items.find(it => it.isPrimary) || captureResult.items[0]
  if (!item) throw new Error('未能抓取主屏截图')
  console.log(`[${new Date().toISOString()}] [voice] capture completed in ${Date.now() - captureStartAt}ms: ${item.savedPath}`)

  const display = screen.getAllDisplays().find(d => d.id === item.displayId) || screen.getPrimaryDisplay()
  const imageSize = { width: item.width, height: item.height }

  const parseResult = await runVoiceOcrWithImage(item.savedPath, backend, options)

  return {
    ocrLines: parseResult.ocrLines || [],
    lineCount: parseResult.lineCount || 0,
    imagePath: item.savedPath,
    imageWidth: item.width,
    imageHeight: item.height,
    displayId: display.id,
    displayBounds: display.bounds,
    backend,
    windowHandle: null,
    mapImageRectToSpaces: (rect) => mapFullScreenImageRect({ rect, display, imageSize }),
  }
}

// “打开 X” 优先只 OCR 当前焦点窗口，减少整屏 OCR 的范围和误命中。
async function captureAndOcrFocusedWindow(options = {}) {
  const backend = normalizeVoiceOcrBackend(options.backend)
  const snapshot = await windowRegistry.refreshSnapshot()
  const focusedWindow = snapshot.focusedWindow
  if (!focusedWindow?.handle) {
    throw new Error('当前没有可用的焦点窗口')
  }

  const capturedWindow = await captureWindowImage(focusedWindow.handle)
  const display = screen.getDisplayMatching(focusedWindow.bounds)
  const imageSize = { width: capturedWindow.width, height: capturedWindow.height }
  const parseResult = await runVoiceOcrWithImage(capturedWindow.imagePath, backend, options)

  return {
    ocrLines: parseResult.ocrLines || [],
    lineCount: parseResult.lineCount || 0,
    imagePath: capturedWindow.imagePath,
    imageWidth: capturedWindow.width,
    imageHeight: capturedWindow.height,
    backend,
    window: focusedWindow,
    windowHandle: focusedWindow.handle,
    displayId: display.id,
    displayBounds: display.bounds,
    mapImageRectToSpaces: (rect) => mapWindowImageRect({
      rect,
      windowBounds: focusedWindow.bounds,
      imageSize,
      displayBounds: display?.bounds,
    }),
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
    : mimeType?.includes('wav')
      ? 'wav'
    : mimeType?.includes('mp4')
      ? 'm4a'
      : mimeType?.includes('mpeg')
        ? 'mp3'
        : 'webm'

  const filePath = path.join(tempRoot, `recording-${Date.now()}.${extension}`)
  await fsPromises.writeFile(filePath, Buffer.from(bytes))
  return filePath
}

function pushDictationEvent(payload) {
  if (!payload) return
  mainWindow?.webContents.send('bridge:dictation-event', payload)
}

function logVoiceMessage(message) {
  const at = new Date().toISOString()
  const line = `[${at}] ${message}`
  console.log(line)
  mainWindow?.webContents.send('bridge:voice-log', { message: line, at })
}

// 本地语音入口统一收口到这里，避免快捷键链路和主进程连续听写各自维护一份逻辑。
async function handleVoiceAudioPayload(payload = {}) {
  await ensureManagedSenseVoiceServiceReady()
  // language 由 renderer 或主进程听写会话透传过来（auto / zh / en / ja / ko / yue）。
  const asr = await transcribeSenseVoiceAudio(payload.filePath, {
    ...payload,
    language: payload.language,
  })
  const transcript = String(asr.text || '').trim()
  const routed = voiceRouter ? await voiceRouter.handleTranscript(transcript, {
    backend: normalizeVoiceOcrBackend(payload.ocrBackend),
    spatialMemoryEnabled: Boolean(payload.spatialMemoryEnabled),
  }) : { handled: false, reason: 'router-missing' }
  return { transcript, asr, routed, state: voiceRouter?.getState() }
}

async function stopDictationSession(reason = 'manual') {
  const activeSession = dictationSession
  dictationSession = null
  if (!activeSession) return { ok: true, reason, active: false }
  await activeSession.stop(reason)
  return { ok: true, reason, active: true }
}

app.whenReady().then(async () => {
  await spatialMemoryStore.load()
  await loadAppSettings()
  startManagedSenseVoiceService().catch((error) => {
    managedSenseVoiceState = {
      ...managedSenseVoiceState,
      status: 'error',
      lastError: String(error.message || error),
    }
  })
  voiceRouter = createVoiceActionRouter({
    captureAndOcr: captureAndOcrPrimaryDisplay,
    captureAndOcrFocusedWindow,
    resolveSpatialMemoryCandidate: async ({ keyword, backend }) => tryResolveCandidateFromSpatialMemory({
      keyword,
      backend,
      logger: (msg) => {
        const at = new Date().toISOString()
        const message = `[${at}] ${msg}`
        console.log(message)
        mainWindow?.webContents.send('bridge:voice-log', { message, at })
      },
    }),
    rememberSpatialSelection: async (payload) => rememberSpatialSelection({
      ...payload,
      logger: (msg) => {
        const at = new Date().toISOString()
        const message = `[${at}] ${msg}`
        console.log(message)
        mainWindow?.webContents.send('bridge:voice-log', { message, at })
      },
    }),
    highlightCandidates: renderCandidateHighlights,
    clearIndicators: clearIndicatorWindows,
    clickAt: async (x, y) => executeActionPlan([{ action: 'click_at', args: { x, y } }]),
    clickWindowPoint: async (handle, localX, localY) => clickWindowLocalPoint(handle, localX, localY),
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
    const appSettings = await loadAppSettings()
    return {
      hasDashscopeApiKey: Boolean(process.env.DASHSCOPE_API_KEY),
      baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: process.env.QWEN_MODEL || 'qwen3-omni-flash',
      providers: listProviderStatuses(),
      omniparser: {
        baseURL: process.env.OMNIPARSER_BASE_URL || 'http://127.0.0.1:8000',
        managed: managedOmniParserState,
      },
      ppocr: {
        baseURL: process.env.PPOCR_BASE_URL || 'http://127.0.0.1:8020',
        managed: managedPPOcrState,
      },
      voiceOcr: {
        profile: appSettings.voiceOcrBackend,
        backend: normalizeVoiceOcrBackend(appSettings.voiceOcrBackend),
        supported: Object.keys(VOICE_OCR_PROFILE_TABLE),
        options: Object.values(VOICE_OCR_PROFILE_TABLE),
      },
      settings: appSettings,
      sensevoice: {
        baseURL: process.env.SENSEVOICE_BASE_URL || 'http://127.0.0.1:8010',
        managed: managedSenseVoiceState,
      },
      spatialMemory: {
        ...spatialMemoryStore.buildStats(),
      },
      platform: process.platform,
      shortcut: shortcutManager.getState(),
    }
  })

  ipcMain.handle('bridge:get-shortcut-state', async () => {
    return shortcutManager.getState()
  })

  ipcMain.handle('bridge:get-app-settings', async () => {
    return loadAppSettings()
  })

  ipcMain.handle('bridge:update-app-settings', async (_event, payload = {}) => {
    return saveAppSettings(payload)
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

  ipcMain.handle('bridge:dictation-session-start', async (_event, payload = {}) => {
    await stopDictationSession('restart')
    const sessionId = nextDictationSessionId
    nextDictationSessionId += 1

    // 主进程接管会话后，renderer 只需要持续喂 PCM 块，不再关心断句细节。
    dictationSession = new MainDictationSession({
      sessionId,
      language: payload.language,
      ocrBackend: normalizeVoiceOcrProfile(payload.ocrBackend),
      spatialMemoryEnabled: Boolean(payload.spatialMemoryEnabled),
      logger: (message) => logVoiceMessage(message),
      emitEvent: (eventPayload) => pushDictationEvent(eventPayload),
      saveRecording: (recordingPayload) => saveRecordingToTemp(recordingPayload),
      routeAudio: (audioPayload) => handleVoiceAudioPayload(audioPayload),
    })

    pushDictationEvent({ type: 'started', sessionId })
    // logVoiceMessage(`[dictation-main] session started id=${sessionId} lang=${payload.language || 'auto'}`)
    return { ok: true, sessionId, sampleRate: 16000 }
  })

  ipcMain.on('bridge:dictation-session-push-chunk', (_event, payload = {}) => {
    if (!dictationSession) return
    if (payload.sessionId !== dictationSession.sessionId) return
    try {
      dictationSession.pushChunk(payload.samples, payload.sampleRate)
    } catch (error) {
      const message = String(error?.message || error)
      pushDictationEvent({
        type: 'error',
        sessionId: payload.sessionId,
        stage: 'push-chunk',
        message,
      })
      logVoiceMessage(`[dictation-main] push chunk failed: ${message}`)
    }
  })

  ipcMain.handle('bridge:dictation-session-stop', async (_event, payload = {}) => {
    return stopDictationSession(payload.reason || 'manual')
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

  ipcMain.handle('bridge:apply-ocr-service', async (_event, payload = {}) => {
    return applySelectedOcrService(payload.profile || payload.backend)
  })

  ipcMain.handle('bridge:test-omniparser', async (_event, payload = {}) => {
    const profile = normalizeVoiceOcrBackend(currentVoiceOcrProfile) === 'omniparser'
      ? currentVoiceOcrProfile
      : 'omniparser-gpu'
    await ensureManagedOmniParserServiceReady({ profile })
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
    const profile = normalizeVoiceOcrBackend(currentVoiceOcrProfile) === 'ppocr'
      ? currentVoiceOcrProfile
      : 'ppocr-gpu'
    await ensureManagedPPOcrServiceReady({ profile })
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
    return handleVoiceAudioPayload(payload)
  })

  ipcMain.handle('bridge:voice-route-text', async (_event, payload = {}) => {
    // 调试入口：直接喂文本给 FSM（跳过 ASR），方便无麦调试。
    const transcript = String(payload?.transcript || '').trim()
    const routed = voiceRouter ? await voiceRouter.handleTranscript(transcript, {
      backend: normalizeVoiceOcrBackend(payload.ocrBackend),
      spatialMemoryEnabled: Boolean(payload.spatialMemoryEnabled),
    }) : { handled: false, reason: 'router-missing' }
    return { transcript, routed, state: voiceRouter?.getState() }
  })

  ipcMain.handle('bridge:voice-reset', async () => {
    voiceRouter?.reset('manual')
    return { ok: true, state: voiceRouter?.getState() }
  })

  ipcMain.on('bridge:voice-log-renderer', (_event, payload = {}) => {
    const at = new Date().toISOString()
    const text = String(payload?.message || '').trim()
    if (!text) return
    const message = `[renderer] ${text}`
    console.log(message)
    mainWindow?.webContents.send('bridge:voice-log', { message, at })
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
    // 终端里只记录“文字语义发生变化”的 overlay 状态，避免音量电平更新把日志刷满。
    if (payload?.status) {
      const logKey = JSON.stringify({
        status: payload.status || '',
        title: payload.title || '',
        subtitle: payload.subtitle || '',
      })
      if (logKey !== lastOverlayLogKey) {
        lastOverlayLogKey = logKey
        console.log(`[overlay] status=${payload.status} title=${payload.title || ''} subtitle=${payload.subtitle || ''}`)
      }
    }
    if (payload?.status === 'listening') {
      recordingByShortcut = true
    }

    if (payload?.status === 'waiting' || payload?.status === 'executing' || payload?.status === 'idle') {
      if (payload.status !== 'listening') {
        recordingByShortcut = false
      }
    }

    setOverlayState(payload)
    if (shouldShowFocusIndicatorForOverlay(payload)) {
      startFocusedWindowIndicator()
      return
    }
    void stopFocusedWindowIndicator()
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
  void stopFocusedWindowIndicator()
  void stopDictationSession('app-quit')
  stopManagedSenseVoiceService()
  stopManagedPPOcrService()
  stopManagedOmniParserService()
  shortcutManager.stop()
})
