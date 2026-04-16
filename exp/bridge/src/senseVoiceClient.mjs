import fsPromises from 'node:fs/promises'
import path from 'node:path'

import { prepareAudioForUpload } from './transcribeQwen.mjs'

const DEFAULT_TIMEOUT_MS = 120000

function getDefaultBaseUrl() {
  return process.env.SENSEVOICE_BASE_URL || 'http://127.0.0.1:8010'
}

function normalizeBaseUrl(baseURL) {
  return String(baseURL || getDefaultBaseUrl()).replace(/\/+$/, '')
}

// 统一封装本地 SenseVoice 服务请求，避免调用侧重复处理超时和错误文本。
async function requestSenseVoice(pathname, options = {}) {
  const baseURL = normalizeBaseUrl(options.baseURL)
  const response = await fetch(`${baseURL}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body,
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`SenseVoice 请求失败 (${response.status}): ${body || response.statusText}`)
  }

  return {
    baseURL,
    payload: await response.json(),
  }
}

export async function probeSenseVoice(options = {}) {
  const { baseURL, payload } = await requestSenseVoice('/probe/', options)
  return {
    ok: true,
    baseURL,
    payload,
  }
}

// 语言白名单：与 SenseVoice 官方支持保持一致，非法值统一回落到 auto，避免服务端报错。
const ALLOWED_LANGUAGES = new Set(['auto', 'zh', 'en', 'ja', 'ko', 'yue'])

function normalizeLanguage(value) {
  if (!value) return null
  const lowered = String(value).toLowerCase()
  return ALLOWED_LANGUAGES.has(lowered) ? lowered : null
}

export async function transcribeSenseVoiceAudio(filePath, options = {}) {
  const resolvedPath = path.resolve(filePath)
  let prepared = null

  try {
    // SenseVoice 本地服务统一走 wav，减少 Windows 下编解码兼容差异。
    prepared = await prepareAudioForUpload(resolvedPath, { forceFormat: 'wav' })
    const buffer = await fsPromises.readFile(prepared.uploadPath)
    const startedAt = Date.now()
    const language = normalizeLanguage(options.language)
    const { baseURL, payload } = await requestSenseVoice('/transcribe/', {
      ...options,
      method: 'POST',
      body: JSON.stringify({
        audio_base64: buffer.toString('base64'),
        format: prepared.format,
        stream: Boolean(options.stream),
        use_vad: Boolean(options.useVad),
        chunk_duration_ms: options.chunkDurationMs ?? 600,
        // language 仅在用户显式指定时下发，否则用服务端启动时的默认（通常是 auto）。
        ...(language ? { language } : {}),
      }),
    })

    return {
      ok: true,
      baseURL,
      audioPath: resolvedPath,
      preparedAudioPath: prepared.uploadPath,
      convertedToWav: Boolean(prepared.converted),
      localLatencyMs: Date.now() - startedAt,
      serviceLatencySeconds: payload.latency ?? null,
      text: payload.text || '',
      mode: payload.mode || 'sensevoice-small',
      stream: Boolean(payload.stream),
      useVad: Boolean(payload.use_vad),
      language: payload.language || language || '',
      chunks: Array.isArray(payload.chunks) ? payload.chunks : [],
      rawResult: payload.raw_result || null,
    }
  } finally {
    // 仅清理由客户端临时转出的 wav，避免污染系统临时目录。
    if (prepared?.converted && prepared?.uploadPath && prepared.uploadPath !== resolvedPath) {
      await fsPromises.unlink(prepared.uploadPath).catch(() => {})
    }
  }
}
