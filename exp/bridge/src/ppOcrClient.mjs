import fsPromises from 'node:fs/promises'

const DEFAULT_BASE_URL = process.env.PPOCR_BASE_URL || 'http://127.0.0.1:8020'
const DEFAULT_TIMEOUT_MS = 120000

function normalizeBaseUrl(baseURL) {
  return String(baseURL || DEFAULT_BASE_URL).replace(/\/+$/, '')
}

// 统一封装本地 PP-OCR 服务请求，避免主进程散落重复错误处理。
async function requestPPOcr(pathname, options = {}) {
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
    throw new Error(`PP-OCR 请求失败 (${response.status}): ${body || response.statusText}`)
  }

  return {
    baseURL,
    payload: await response.json(),
  }
}

export async function probePPOcr(options = {}) {
  const { baseURL, payload } = await requestPPOcr('/probe/', options)
  return {
    ok: true,
    baseURL,
    payload,
  }
}

// 把截图直接编码为 base64 发送给本地 OCR 服务，减少路径耦合。
export async function testPPOcrWithImage(imagePath, options = {}) {
  const buffer = await fsPromises.readFile(imagePath)
  const startedAt = Date.now()
  const { baseURL, payload } = await requestPPOcr('/parse/', {
    ...options,
    method: 'POST',
    body: JSON.stringify({
      base64_image: buffer.toString('base64'),
    }),
  })

  return {
    ok: true,
    baseURL,
    imagePath,
    localLatencyMs: Date.now() - startedAt,
    serviceLatencySeconds: payload.latency ?? null,
    lineCount: payload.line_count ?? (Array.isArray(payload.ocr_lines) ? payload.ocr_lines.length : 0),
    ocrLines: payload.ocr_lines || [],
  }
}
