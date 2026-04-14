import path from 'node:path'

import { parseActionsFromTranscript } from './commandMatcher.mjs'
import { logLlmPrompt, logLlmResponse } from './llmDebug.mjs'
import { buildProviderExtraBody, createCompatibleClient, normalizeProvider } from './providerConfig.mjs'
import { buildAudioDataUrl, prepareAudioForUpload } from './transcribeQwen.mjs'

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

function buildIntentSystemPrompt() {
  return [
    '你是桌面动作解析器。用户不会和你打招呼、询问你任何问题，你只要帮助用户将意图转写成工具函数。你绝对不能误以为用户在询问你任何问题。',
    '你只能返回 JSON，不能解释。',
    '返回格式固定为 {"translate":"...","plan":[{"action":"...","args":{...}},{若需要1个以上的动作},...],"reason":"如果不调用input_text函数，简短解释你不调用的原因"}。',
  ].join('\n')
}

function buildIntentUserPrompt(transcript, windows) {
  const windowSummary = buildWindowSummary(windows)

  // 这里改成多行模板字符串，后续调整函数说明和规则时更直观。
  return `
用户指令：
${transcript}

窗口列表：
${windowSummary}

可选函数：
- \`focus_current()\`
  适用于“切到当前窗口 / 聚焦当前窗口”这类没有明确目标窗口的指令。
- \`close_current()\`
  适用于“关闭这个窗口”这类没有明确目标窗口的指令。
- \`focus_window({ id: "" })\`
  适用于要聚焦某个具体窗口；必须从窗口列表里选 id，只传 \`id\`。
  如果用户说“打开 A”，但窗口列表里已经有 A 的窗口，优先用这个函数，不要用 \`open_app\`。
- \`close_window({ id: "" })\`
  适用于要关闭某个具体窗口；必须从窗口列表里选 id，只传 \`id\`。
- \`input_text({ text: "" })\`
  适用于用户要求输入、回复、填写文本的情况；请使用该函数帮助用户输入；
  用户没有特别指定窗口时，不需要考虑窗口调度和焦点状态，直接使用此工具输入即可;
  需要输入的文本直接放进 \`text\`。
- \`open_app({ name: "" })\`
  仅在目标应用当前没有现成窗口时使用。
- \`send_shortcut({ shortcut: "ctrl+w" })\`
  仅允许 \`cmd+w\`、\`ctrl+w\`、\`alt+f4\`。

规则：
- 只返回 JSON。
- 如果不确定动作，返回空数组。

请直接返回 JSON。
`.trim()
}

function buildAudioIntentUserPrompt(windows) {
  const windowSummary = buildWindowSummary(windows)

  // 音频链路与文本链路共用同一套函数说明，只把输入来源换成音频。
  return `
输入来源：
音频

窗口列表：
${windowSummary}

可选函数：
- \`focus_current()\`
  适用于“切到当前窗口 / 聚焦当前窗口”这类没有明确目标窗口的指令。
- \`close_current()\`
  适用于“关闭这个窗口”这类没有明确目标窗口的指令。
- \`focus_window({ id: "" })\`
  适用于要聚焦某个具体窗口；必须从窗口列表里选 id，只传 \`id\`。
  如果用户说“打开 A”，但窗口列表里已经有 A 的窗口，优先用这个函数，不要用 \`open_app\`。
- \`close_window({ id: "" })\`
  适用于要关闭某个具体窗口；必须从窗口列表里选 id，只传 \`id\`。
- \`input_text({ text: "" })\`
  适用于用户要求输入、回复、填写文本的情况；请使用该函数帮助用户输入；
  用户没有特别指定窗口时，不需要考虑窗口调度和焦点状态，直接使用此工具输入即可;
  需要输入的文本直接放进 \`text\`。
- \`open_app({ name: "" })\`
  仅在目标应用当前没有现成窗口时使用。
- \`send_shortcut({ shortcut: "ctrl+w" })\`
  仅允许 \`cmd+w\`、\`ctrl+w\`、\`alt+f4\`。

规则：
- \`translate\` 必须精确填写你从音频里听到的文本精确原话原文，不要有任何修改。
- 只返回 JSON。
- 如果不确定动作，\`plan\` 返回空数组。

请直接返回 JSON。
`.trim()
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

function finalizeIntentResult(raw, transcriptFallback, windows, parser) {
  try {
    const parsed = JSON.parse(raw)
    const transcript = String(parsed.stt || transcriptFallback || '').trim()
    const plan = sanitizeLlmPlan(parsed.plan, windows)

    return {
      transcript,
      plan,
      stt: transcript,
      unmatchedSegments: plan.length > 0 ? [] : (transcript ? [transcript] : []),
      safe: plan.length > 0,
      parser,
      raw,
    }
  } catch {
    const fallback = parseActionsFromTranscript(transcriptFallback)
    return {
      ...fallback,
      stt: transcriptFallback,
      parser: 'fallback-rule',
      raw,
    }
  }
}

export async function parseIntentWithWindows(commandText, windows, options = {}) {
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

  const provider = normalizeProvider(options.provider)
  const { client, config } = createCompatibleClient(provider)
  const extraBody = buildProviderExtraBody(provider)

  const userPrompt = buildIntentUserPrompt(transcript, windows)

  logLlmPrompt('parseIntentWithWindows', {
    provider,
    model: config.model,
    prompt: userPrompt,
  })

  const completion = await client.chat.completions.create({
    model: config.model,
    stream: false,
    modalities: ['text'],
    extra_body: extraBody,
    messages: [
      {
        role: 'system',
        content: buildIntentSystemPrompt(),
      },
      {
        role: 'user',
        content: userPrompt,
      },
    ],
  })

  const raw = completion.choices?.[0]?.message?.content?.trim() || ''
  logLlmResponse('parseIntentWithWindows', raw)

  return finalizeIntentResult(raw, transcript, windows, 'llm')
}

export async function parseAudioIntentWithWindows(filePath, windows, options = {}) {
  const provider = normalizeProvider(options.provider)
  const { client, config } = createCompatibleClient(provider)
  const extraBody = buildProviderExtraBody(provider)
  // 语音链路固定关闭流式，避免分片输出增加状态复杂度。
  const stream = false
  const userPrompt = buildAudioIntentUserPrompt(windows)
  const { uploadPath, format, converted } = await prepareAudioForUpload(path.resolve(filePath))

  logLlmPrompt('parseAudioIntentWithWindows', {
    provider,
    model: config.model,
    prompt: userPrompt,
    audioFilePath: path.resolve(filePath),
    audioFormat: format,
    convertedInputToWav: converted,
    stream,
  })

  const requestStartedAt = Date.now()
  let raw = ''
  let usage = null
  let firstTextLatencyMs = null

  const requestPayload = {
    model: config.model,
    modalities: ['text'],
    extra_body: extraBody,
    messages: [
      {
        role: 'system',
        content: buildIntentSystemPrompt(),
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_audio',
            input_audio: {
              data: buildAudioDataUrl(uploadPath, format),
              format,
            },
          },
          {
            type: 'text',
            text: userPrompt,
          },
        ],
      },
    ],
  }

  if (stream) {
    // 流式模式只统计首字延迟，最终仍以完整 JSON 文本作为解析结果。
    const completionStream = await client.chat.completions.create({
      ...requestPayload,
      stream: true,
      stream_options: {
        include_usage: true,
      },
    })

    for await (const chunk of completionStream) {
      if (Array.isArray(chunk.choices) && chunk.choices.length > 0) {
        const content = typeof chunk.choices[0]?.delta?.content === 'string' ? chunk.choices[0].delta.content : ''
        if (content) {
          if (firstTextLatencyMs === null) {
            firstTextLatencyMs = Date.now() - requestStartedAt
          }
          raw += content
        }
        continue
      }

      if (chunk.usage) {
        usage = chunk.usage
      }
    }
  } else {
    const completion = await client.chat.completions.create({
      ...requestPayload,
      stream: false,
    })

    raw = completion.choices?.[0]?.message?.content?.trim() || ''
    usage = completion.usage ?? null
    firstTextLatencyMs = Date.now() - requestStartedAt
    logLlmResponse('parseAudioIntentWithWindows', completion)
  }

  if (stream) {
    logLlmResponse('parseAudioIntentWithWindows', {
      content: raw,
      usage,
    })
  }

  return {
    ...finalizeIntentResult(raw, '', windows, 'llm-audio'),
    usage,
    timing: {
      stream,
      first_text_latency_ms: firstTextLatencyMs,
      total_latency_ms: Date.now() - requestStartedAt,
      converted_input_to_wav: converted,
    },
  }
}
