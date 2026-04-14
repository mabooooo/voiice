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
      const target =
        windowMapByHandle.get(String(item.args?.handle ?? '')) ||
        windowMapByShortId.get(String(item.args?.shortId ?? ''))

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

    if (item.action === 'type_text_to_focused_input' && typeof item.args?.text === 'string' && item.args.text.trim()) {
      sanitized.push({
        action: 'type_text_to_focused_input',
        args: { text: item.args.text.trim() },
        source: item.source || 'llm',
      })
      continue
    }

    if (item.action === 'focus_front_window' || item.action === 'close_front_window') {
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
  const userPrompt = `请根据用户指令和当前窗口列表，返回 JSON：{"plan":[{"action":"...","args":{...},"source":"..."}]}\n\n用户指令：${transcript}\n\n当前窗口列表：\n${windowSummary}\n\n规则：\n1. 只返回 JSON，不要解释。\n2. 只允许动作：focus_front_window、close_front_window、focus_window、close_window、type_text_to_focused_input、open_app、send_shortcut。\n3. 如果用户明确提到某个现有窗口，或提到某个已经在窗口列表中的应用，例如“打开微信”“打开 Notion”，优先理解为把该应用现有窗口拉到最前，返回 focus_window，并使用窗口 id。\n4. 只有当窗口列表里不存在该应用的窗口时，才允许返回 open_app。\n5. 如果是模糊的“关闭这个窗口/聚焦当前窗口”，可返回 close_front_window / focus_front_window。\n6. 若要关闭/聚焦具体窗口，必须返回 close_window / focus_window，并在 args 中带上 shortId 或 handle。优先使用 shortId。\n7. send_shortcut 只允许 cmd+w、ctrl+w、alt+f4。\n8. 无法确定时返回空数组。`

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
          '你是桌面动作解析器。你只能返回 JSON，不能解释。你只能从白名单动作中选择：focus_front_window, close_front_window, focus_window, close_window, type_text_to_focused_input, open_app, send_shortcut。若是 focus_window / close_window，必须从给定窗口列表中选择 shortId 或 handle。若无法确定，返回空数组。',
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
    return {
      transcript,
      plan,
      unmatchedSegments: plan.length > 0 ? [] : [transcript],
      safe: plan.length > 0,
      parser: 'llm',
      raw,
    }
  } catch {
    const fallback = parseActionsFromTranscript(transcript)
    return {
      ...fallback,
      parser: 'fallback-rule',
      raw,
    }
  }
}
