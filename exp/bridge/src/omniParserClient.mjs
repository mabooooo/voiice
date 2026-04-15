import fsPromises from 'node:fs/promises'

const DEFAULT_BASE_URL = process.env.OMNIPARSER_BASE_URL || 'http://127.0.0.1:8000'
const DEFAULT_TIMEOUT_MS = 120000

function normalizeBaseUrl(baseURL) {
  return String(baseURL || DEFAULT_BASE_URL).replace(/\/+$/, '')
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
export async function testOmniParserWithImage(imagePath, options = {}) {
  const buffer = await fsPromises.readFile(imagePath)
  const startedAt = Date.now()
  const { baseURL, payload } = await requestOmniParser('/parse/', {
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
    elementCount: payload.element_count ?? (Array.isArray(payload.parsed_content_list) ? payload.parsed_content_list.length : 0),
    parsedContentList: payload.parsed_content_list || [],
    somImageDataUrl: payload.som_image_base64
      ? `data:image/png;base64,${payload.som_image_base64}`
      : '',
  }
}
