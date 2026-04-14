import OpenAI from 'openai'

import { parseActionsFromTranscript } from './commandMatcher.mjs'
import { logLlmPrompt, logLlmResponse } from './llmDebug.mjs'

function createDashscopeClient() {
  const apiKey = process.env.DASHSCOPE_API_KEY
  const baseURL = process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'

  if (!apiKey) {
    throw new Error('未读取到 DASHSCOPE_API_KEY，请先在 exp/bridge/.env 中配置。')
  }

  return new OpenAI({
    apiKey,
    baseURL,
  })
}

function buildWindowSummary(windows) {
  if (!Array.isArray(windows) || windows.length === 0) {
    return '无可用窗口'
  }

  return windows
    .map((item) => {
      const state = item.state || 'unknown'
      return `id=${item.shortId} | appName=${item.appName || 'unknown'} | title=${item.title} | state=${state}`
    })
    .join('\n')
}

function sanitizeLlmPlan(plan, windows) {
  const windowMapByHandle = new Map(windows.map((item) => [String(item.handle), item]))
  const windowMapByShortId = new Map(windows.map((item) => [String(item.shortId), item]))
  const sanitized = []

  for (const item of plan || []) {
    if (!item?.action) {
      continue
    }

    if (item.action === 'focus_window' || item.action === 'close_window') {
      // 兼容 LLM 返回的 id/shortId/handle，统一折叠到当前窗口快照。
      const requestedId = String(item.args?.id ?? '')
      const target =
        windowMapByHandle.get(String(item.args?.handle ?? '')) ||
        windowMapByShortId.get(String(item.args?.shortId ?? '')) ||
        windowMapByShortId.get(requestedId)

      if (!target) {
        continue
      }

      sanitized.push({
        action: item.action,
        args: {
          handle: target.handle,
          shortId: target.shortId,
          title: target.title,
          appName: target.appName,
          processId: target.processId,
        },
        source: item.source || 'llm',
      })
      continue
    }

    if (item.action === 'open_app' && item.args?.name === 'WeChat') {
      sanitized.push({
        action: 'open_app',
        args: { name: 'WeChat' },
        source: item.source || 'llm',
      })
      continue
    }

    if (item.action === 'send_shortcut' && typeof item.args?.shortcut === 'string') {
      sanitized.push({
        action: 'send_shortcut',
        args: { shortcut: item.args.shortcut },
        source: item.source || 'llm',
      })
      continue
    }

    if (item.action === 'input_text' && typeof item.args?.text === 'string' && item.args.text.trim()) {
      sanitized.push({
        action: 'input_text',
        args: { text: item.args.text.trim() },
        source: item.source || 'llm',
      })
      continue
    }

    if (item.action === 'focus_current' || item.action === 'close_current') {
      sanitized.push({
        action: item.action,
        source: item.source || 'llm',
      })
    }
  }

  return sanitized
}

export async function parseIntentWithWindows(commandText, windows) {
  const transcript = commandText.trim()
  if (!transcript) {
    return {
      transcript,
      plan: [],
      unmatchedSegments: [],
      safe: false,
      parser: 'empty',
    }
  }

  const client = createDashscopeClient()
  const model = process.env.QWEN_MODEL || 'qwen3-omni-flash'

  const windowSummary = buildWindowSummary(windows)
  const userPrompt = `返回 JSON：{"plan":[{"action":"...","args":{...}}],"stt":"..."}\n用户指令：${transcript}\n窗口：\n${windowSummary}\n函数：focus_current(), close_current(), focus_window({id:"W03"}), close_window({id:"W03"}), input_text({text:""}), open_app({name:""}), send_shortcut({shortcut:"ctrl+w"})\n规则：\n1. 只返回 JSON。\n2. 已有应用窗口时，“打开A”优先用 focus_window，不用 open_app。\n3. “关闭这个窗口/切到当前窗口”用 close_current / focus_current。\n4. 具体窗口只用 focus_window / close_window，args 里只放 id，优先 shortId。\n5. 输入、回复、填写文本都用 input_text，args.text 直接放最终内容。\n6. send_shortcut 只允许 cmd+w、ctrl+w、alt+f4。\n7. 不确定就返回空数组。`

  logLlmPrompt('parseIntentWithWindows', userPrompt)

  const completion = await client.chat.completions.create({
    model,
    stream: false,
    modalities: ['text'],
    extra_body: {
      enable_thinking: false,
    },
    messages: [
      {
        role: 'system',
        content:
          '你是桌面动作解析器。你只能返回 JSON，不能解释。你只能从这些函数中选择：focus_current, close_current, focus_window, close_window, input_text, open_app, send_shortcut。具体窗口动作必须从给定窗口列表里选择 id。输入文本一律使用 input_text，并提供 args.text。若无法确定，返回空数组。',
      },
      {
        role: 'user',
        content: userPrompt,
      },
    ],
  })

  const raw = completion.choices?.[0]?.message?.content?.trim() || ''
  logLlmResponse('parseIntentWithWindows', raw)

  try {
    const parsed = JSON.parse(raw)
    const plan = sanitizeLlmPlan(parsed.plan, windows)
    if (plan.length === 0) {
      const fallback = parseActionsFromTranscript(transcript)
      if (fallback.plan.length > 0) {
        return {
          ...fallback,
          stt: parsed.stt || transcript,
          parser: 'fallback-after-empty-llm',
          raw,
        }
      }
    }

    return {
      transcript,
      plan,
      stt: parsed.stt || transcript,
      unmatchedSegments: plan.length > 0 ? [] : [transcript],
      safe: plan.length > 0,
      parser: 'llm',
      raw,
    }
  } catch {
    const fallback = parseActionsFromTranscript(transcript)
    return {
      ...fallback,
      stt: transcript,
      parser: 'fallback-rule',
      raw,
    }
  }
}
