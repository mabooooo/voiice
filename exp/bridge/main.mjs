import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

import dotenv from 'dotenv'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'

import { parseActionsFromTranscript } from './src/commandMatcher.mjs'
import { transcribeCommandAudio } from './src/transcribeQwen.mjs'
import { executeActionPlan } from './src/windowsController.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({
  path: path.join(__dirname, '.env'),
})

function createWindow() {
  const window = new BrowserWindow({
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
  window.loadFile(path.join(__dirname, 'renderer-dist', 'index.html'))
}

async function saveRecordingToTemp({ bytes, mimeType }) {
  const tempRoot = path.join(os.tmpdir(), 'voice-bridge-recordings')
  await fs.mkdir(tempRoot, { recursive: true })

  const extension = mimeType?.includes('ogg')
    ? 'ogg'
    : mimeType?.includes('mp4')
      ? 'm4a'
      : mimeType?.includes('mpeg')
        ? 'mp3'
        : 'webm'

  const filePath = path.join(tempRoot, `recording-${Date.now()}.${extension}`)
  await fs.writeFile(filePath, Buffer.from(bytes))
  return filePath
}

app.whenReady().then(() => {
  createWindow()

  ipcMain.handle('bridge:get-config-status', async () => {
    return {
      hasDashscopeApiKey: Boolean(process.env.DASHSCOPE_API_KEY),
      baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: process.env.QWEN_MODEL || 'qwen3-omni-flash',
      platform: process.platform,
    }
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

  ipcMain.handle('bridge:analyze-audio', async (_event, payload) => {
    const analysis = await transcribeCommandAudio(payload.filePath, {
      stream: payload.stream,
      prompt: payload.prompt,
    })

    const matched = parseActionsFromTranscript(analysis.transcript)
    return {
      ...analysis,
      matched,
    }
  })

  ipcMain.handle('bridge:match-transcript', async (_event, transcript) => {
    return parseActionsFromTranscript(transcript)
  })

  ipcMain.handle('bridge:execute-plan', async (_event, payload) => {
    return executeActionPlan(payload.plan)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
