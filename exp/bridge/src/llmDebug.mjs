function nowLabel() {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function sanitizeForLog(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item))
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const clone = {}

  for (const [key, currentValue] of Object.entries(value)) {
    // 音频 data URL 体积过大，只保留占位说明，避免日志污染终端。
    if (key === 'input_audio' && currentValue && typeof currentValue === 'object') {
      clone[key] = {
        ...sanitizeForLog(currentValue),
        data: '[omitted audio data url]',
      }
      continue
    }

    clone[key] = sanitizeForLog(currentValue)
  }

  return clone
}

function printBlock(title, content) {
  const body = typeof content === 'string' ? content : JSON.stringify(content, null, 2)
  console.log(`\n[LLM DEBUG][${nowLabel()}] ${title}\n${body}\n`)
}

// 只打印最终 prompt，避免把大体积请求体或音频 base64 打到控制台。
export function logLlmPrompt(tag, prompt) {
  printBlock(`${tag} prompt`, prompt)
}

// 显式打印实际请求体，便于核对最终发给 SDK 的 body 结构 - 更加完整，只排除音频base64
export function logLlmRequest(tag, requestBody) {
  // printBlock(`${tag} request`, sanitizeForLog(requestBody))
}

// 统一打印 LLM 响应，便于在终端中快速核对原始 content。
export function logLlmResponse(tag, content) {
  printBlock(`${tag} response`, content)
}
