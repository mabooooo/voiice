import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import OpenAI from 'openai'

const SUPPORTED_AUDIO_FORMATS = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'])

function parseArgs(argv) {
  const args = {
    prompt: '请准确转写这段音频，并提取关键内容。',
    audio: '',
    stream: true,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    const next = argv[index + 1]

    if (current === '--audio' && next) {
      args.audio = next
      index += 1
      continue
    }

    if (current === '--prompt' && next) {
      args.prompt = next
      index += 1
      continue
    }

    if (current === '--no-stream') {
      args.stream = false
    }
  }

  if (!args.audio) {
    throw new Error('缺少 --audio 参数，例如：--audio ./sample.mp3')
  }

  return args
}

function resolveAudioFormat(audioPath) {
  const extension = path.extname(audioPath).replace('.', '').toLowerCase()

  if (!SUPPORTED_AUDIO_FORMATS.has(extension)) {
    throw new Error(`暂不支持的音频格式：${extension || 'unknown'}`)
  }

  return extension
}

function buildAudioDataUrl(audioPath) {
  // 将本地音频转为 data URL，便于直接走 OpenAI 兼容接口上传。
  const fileBuffer = fs.readFileSync(audioPath)
  const format = resolveAudioFormat(audioPath)
  const base64Audio = fileBuffer.toString('base64')
  return {
    format,
    dataUrl: `data:audio/${format};base64,${base64Audio}`,
  }
}

async function run() {
  const { audio, prompt, stream } = parseArgs(process.argv.slice(2))
  const apiKey = process.env.DASHSCOPE_API_KEY
  const baseURL = process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  const model = process.env.QWEN_MODEL || 'qwen3-omni-flash'

  if (!apiKey) {
    throw new Error('未读取到 DASHSCOPE_API_KEY，请先在 .env 中配置。')
  }

  const absoluteAudioPath = path.resolve(process.cwd(), audio)
  if (!fs.existsSync(absoluteAudioPath)) {
    throw new Error(`音频文件不存在：${absoluteAudioPath}`)
  }

  const { dataUrl, format } = buildAudioDataUrl(absoluteAudioPath)
  const client = new OpenAI({
    apiKey,
    baseURL,
  })
  const requestStartedAt = Date.now()

  let outputText = ''
  let usage = null
  let firstTokenLatencyMs = null

  const requestPayload = {
    model,
    modalities: ['text'],
    extra_body: {
      enable_thinking: false,
    },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'input_audio',
            input_audio: {
              data: dataUrl,
              format,
            },
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
  }

  if (stream) {
    // 流式模式下记录首字延迟，便于评估交互体验。
    const completionStream = await client.chat.completions.create({
      ...requestPayload,
      stream: true,
      stream_options: {
        include_usage: true,
      },
    })

    for await (const chunk of completionStream) {
      if (Array.isArray(chunk.choices) && chunk.choices.length > 0) {
        const delta = chunk.choices[0]?.delta
        const content = typeof delta?.content === 'string' ? delta.content : ''

        if (content) {
          if (firstTokenLatencyMs === null) {
            firstTokenLatencyMs = Date.now() - requestStartedAt
          }
          process.stdout.write(content)
          outputText += content
        }
        continue
      }

      if (chunk.usage) {
        usage = chunk.usage
      }
    }
  } else {
    // 非流式模式只有完整响应返回，因此首字延迟与总耗时等价。
    const completion = await client.chat.completions.create({
      ...requestPayload,
      stream: false,
    })

    outputText = completion.choices?.[0]?.message?.content ?? ''
    usage = completion.usage ?? null
    firstTokenLatencyMs = Date.now() - requestStartedAt
    process.stdout.write(outputText)
  }

  process.stdout.write('\n')
  const totalLatencyMs = Date.now() - requestStartedAt

  if (!outputText.trim()) {
    console.warn('模型未返回文本内容，请检查音频格式、时长或提示词。')
  }

  console.log('\n[timing]')
  console.log(
    JSON.stringify(
      {
        stream,
        first_text_latency_ms: firstTokenLatencyMs,
        total_latency_ms: totalLatencyMs,
      },
      null,
      2,
    ),
  )

  if (usage) {
    console.log('\n[usage]')
    console.log(JSON.stringify(usage, null, 2))
  }
}

run().catch((error) => {
  console.error('\n[error]')
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
