import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

import ffmpegPath from 'ffmpeg-static'
import { logLlmPrompt, logLlmRequest, logLlmResponse } from './llmDebug.mjs'
import { buildProviderBodyExtensions, createCompatibleClient, normalizeProvider } from './providerConfig.mjs'

const DIRECT_AUDIO_FORMATS = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'])

function runFfmpegConvert(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      ['-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', outputPath],
      {
        windowsHide: true,
      },
    )

    let stderr = ''

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(stderr || `ffmpeg convert failed with code ${code}`))
    })
  })
}

export async function prepareAudioForUpload(filePath, options = {}) {
  const extension = path.extname(filePath).replace('.', '').toLowerCase()
  const forceFormat = options.forceFormat || ''
  const shouldForceWav = forceFormat === 'wav'

  // 本地服务侧优先接收 wav，避免不同推理后端对压缩音频的支持差异。
  if (DIRECT_AUDIO_FORMATS.has(extension) && (!shouldForceWav || extension === 'wav')) {
    return {
      uploadPath: filePath,
      format: extension,
      converted: false,
    }
  }

  // 录音默认可能是 webm，这里统一转为 wav，避免接口格式兼容问题。
  const tempOutputPath = path.join(os.tmpdir(), `voice-bridge-${Date.now()}.wav`)
  await runFfmpegConvert(filePath, tempOutputPath)
  return {
    uploadPath: tempOutputPath,
    format: 'wav',
    converted: true,
  }
}

export function buildAudioDataUrl(filePath, format) {
  const buffer = fs.readFileSync(filePath)
  return `data:audio/${format};base64,${buffer.toString('base64')}`
}

export async function transcribeCommandAudio(filePath, options = {}) {
  const provider = normalizeProvider(options.provider)
  const stream = Boolean(options.stream)
  // 转写阶段只负责把音频变成稳定文本，动作选择交给后续解析器。
  const prompt = '请将这段音频准确转写为简短中文文本，不要解释，不要补充。'

  const { uploadPath, format, converted } = await prepareAudioForUpload(path.resolve(filePath))
  const { client, config } = createCompatibleClient(provider)
  const bodyExtensions = buildProviderBodyExtensions(provider)

  const requestPayload = {
    model: config.model,
    modalities: ['text'],
    ...bodyExtensions,
    messages: [
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
            text: prompt,
          },
        ],
      },
    ],
  }

  // 调试时只打印真正发给模型的提示词，避免输出音频 data URL。
  logLlmPrompt('transcribeQwen', {
    provider,
    model: config.model,
    prompt,
  })
  logLlmRequest('transcribeQwen', requestPayload)

  const requestStartedAt = Date.now()
  let transcript = ''
  let usage = null
  let firstTextLatencyMs = null

  if (stream) {
    // 流式模式主要用于观测首字延迟，不直接把执行权交给流式分片。
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
          transcript += content
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

    transcript = completion.choices?.[0]?.message?.content ?? ''
    usage = completion.usage ?? null
    firstTextLatencyMs = Date.now() - requestStartedAt
  }

  logLlmResponse('transcribeQwen', {
    transcript: transcript.trim(),
    usage,
  })

  return {
    transcript: transcript.trim(),
    usage,
    timing: {
      stream,
      first_text_latency_ms: firstTextLatencyMs,
      total_latency_ms: Date.now() - requestStartedAt,
      converted_input_to_wav: converted,
    },
  }
}
