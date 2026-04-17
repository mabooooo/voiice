import fsPromises from 'node:fs/promises'

const DEFAULT_BASE_URL = process.env.OMNIPARSER_BASE_URL || 'http://127.0.0.1:8000'
const DEFAULT_TIMEOUT_MS = 120000

function normalizeBaseUrl(baseURL) {
  return String(baseURL || DEFAULT_BASE_URL).replace(/\/+$/, '')
}

// OmniParser 返回的是“文本项 + 图标项”混合结构，这里压成语音路由可直接复用的 ocrLines。
function normalizeParsedItemToOcrLine(item) {
  const bbox = Array.isArray(item?.bbox) && item.bbox.length === 4
    ? item.bbox.map(value => Math.round(Number(value) || 0))
    : null
  if (!bbox) return null

  if (item?.type === 'text') {
    const text = String(item?.text || '').trim()
    return text ? { text, bbox, confidence: Number(item?.confidence) || 0, source: 'omniparser-text' } : null
  }

  const text = String(item?.content || '').trim()
  return text ? { text, bbox, confidence: Number(item?.confidence) || 0, source: 'omniparser-icon' } : null
}

// 统一封装本地 OmniParser 服务请求，避免主进程到处散落 fetch 细节。
async function requestOmniParser(pathname, options = {}) {
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
    throw new Error(`OmniParser 请求失败 (${response.status}): ${body || response.statusText}`)
  }

  return {
    baseURL,
    payload: await response.json(),
  }
}

export async function probeOmniParser(options = {}) {
  const { baseURL, payload } = await requestOmniParser('/probe/', options)
  return {
    ok: true,
    baseURL,
    payload,
  }
}

// 把本地图像转换为 base64 后直接送到本地能力服务，减少服务端文件路径耦合。
// 语音点选链路为了加速 OCR 会先在内存中缩放截图，通过 options.imageBuffer 直接传入，
// 避免把缩放产物落盘（imagePath 仅用于回显与日志）。
export async function testOmniParserWithImage(imagePath, options = {}) {
  const buffer = options.imageBuffer instanceof Buffer
    ? options.imageBuffer
    : await fsPromises.readFile(imagePath)
  const startedAt = Date.now()
  const { baseURL, payload } = await requestOmniParser('/parse/', {
    ...options,
    method: 'POST',
    body: JSON.stringify({
      base64_image: buffer.toString('base64'),
    }),
  })

  const parsedContentList = payload.parsed_content_list || []
  const ocrLines = parsedContentList
    .map(normalizeParsedItemToOcrLine)
    .filter(Boolean)

  return {
    ok: true,
    baseURL,
    imagePath,
    localLatencyMs: Date.now() - startedAt,
    serviceLatencySeconds: payload.latency ?? null,
    elementCount: payload.element_count ?? (Array.isArray(parsedContentList) ? parsedContentList.length : 0),
    parsedContentList,
    lineCount: ocrLines.length,
    ocrLines,
    somImageDataUrl: payload.som_image_base64
      ? `data:image/png;base64,${payload.som_image_base64}`
      : '',
  }
}
