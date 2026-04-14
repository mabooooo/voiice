function nowLabel() {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function printBlock(title, content) {
  const body = typeof content === 'string' ? content : JSON.stringify(content, null, 2)
  console.log(`\n[LLM DEBUG][${nowLabel()}] ${title}\n${body}\n`)
}

// 只打印最终 prompt，避免把大体积请求体或音频 base64 打到控制台。
export function logLlmPrompt(tag, prompt) {
  // printBlock(`${tag} prompt`, prompt)
}

// 统一打印 LLM 响应，便于在终端中快速核对原始 content。
export function logLlmResponse(tag, content) {
  printBlock(`${tag} response`, content)
}
