const TARGET_SAMPLE_RATE = 16000
const PROCESSOR_BUFFER_SIZE = 4096
const CHUNK_DURATION_MS = 100
const CHUNK_SIZE = Math.round((TARGET_SAMPLE_RATE * CHUNK_DURATION_MS) / 1000)

async function createAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) throw new Error('当前环境缺少 AudioContext')
  return new AudioContextClass()
}

// 全局快捷键来自主进程 IPC，不一定会被浏览器判定成用户手势，这里显式 resume。
async function ensureAudioContextRunning(context, logger) {
  logger(`[dictation] AudioContext state=${context.state}`)
  if (context.state === 'running') return
  await context.resume()
  logger(`[dictation] AudioContext resumed -> state=${context.state}`)
}

// renderer 侧现在只负责采集 PCM，并按固定 chunk 推给主进程。
export async function startDictationPcmCapture({
  deviceId,
  logger = () => {},
  onChunk,
  onLevel,
  onError,
} = {}) {
  if (typeof onChunk !== 'function') {
    throw new Error('startDictationPcmCapture 需要 onChunk 回调')
  }

  const mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      autoGainControl: false,
      noiseSuppression: false,
      echoCancellation: false,
      channelCount: 1,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
  })

  const audioTrack = mediaStream.getAudioTracks()[0]
  const trackSettings = audioTrack?.getSettings?.() || {}
  logger(`[dictation] track settings rate=${trackSettings.sampleRate || 'unknown'} channels=${trackSettings.channelCount || 'unknown'} device=${trackSettings.deviceId || 'default'}`)

  let context
  try {
    context = await createAudioContext()
    await ensureAudioContextRunning(context, logger)
  } catch (error) {
    mediaStream.getTracks().forEach((track) => track.stop())
    throw error
  }

  const source = context.createMediaStreamSource(mediaStream)
  const processor = context.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1)
  const silentSink = context.createGain()
  silentSink.gain.value = 0
  silentSink.connect(context.destination)

  const ratio = context.sampleRate / TARGET_SAMPLE_RATE
  let chunkBuffer = new Float32Array(CHUNK_SIZE)
  let chunkOffset = 0
  let lastLevelPushAt = 0
  let stopped = false

  processor.onaudioprocess = (event) => {
    if (stopped) return
    try {
      const input = event.inputBuffer.getChannelData(0)
      const output = event.outputBuffer.getChannelData(0)
      output.fill(0)

      const resampled = Math.abs(ratio - 1) > 1e-3 ? resampleLinear(input, ratio) : input
      const level = computeLevel(input)
      const now = performance.now()
      // 电平只做轻量节流，避免在监听中把 IPC 推得过密。
      if (typeof onLevel === 'function' && now - lastLevelPushAt >= 80) {
        lastLevelPushAt = now
        onLevel(level)
      }

      let readOffset = 0
      while (readOffset < resampled.length) {
        const remaining = CHUNK_SIZE - chunkOffset
        const takeCount = Math.min(remaining, resampled.length - readOffset)
        chunkBuffer.set(resampled.subarray(readOffset, readOffset + takeCount), chunkOffset)
        chunkOffset += takeCount
        readOffset += takeCount

        if (chunkOffset >= CHUNK_SIZE) {
          // IPC 直接发 Int16，带宽相比 Float32 减半，且对语音质量无损。
          const emitted = float32ToInt16(chunkBuffer)
          chunkBuffer = new Float32Array(CHUNK_SIZE)
          chunkOffset = 0
          Promise.resolve(onChunk(emitted)).catch((error) => {
            onError?.(error)
          })
        }
      }
    } catch (error) {
      onError?.(error)
    }
  }

  source.connect(processor)
  processor.connect(silentSink)
  logger(`[dictation] PCM capture ready contextRate=${context.sampleRate} targetRate=${TARGET_SAMPLE_RATE}`)

  const stop = async () => {
    if (stopped) return
    stopped = true
    processor.onaudioprocess = null
    try { source.disconnect() } catch {}
    try { processor.disconnect() } catch {}
    try { silentSink.disconnect() } catch {}
    mediaStream.getTracks().forEach((track) => track.stop())
    await context.close().catch(() => {})
  }

  return {
    stop,
    sampleRate: TARGET_SAMPLE_RATE,
    chunkSize: CHUNK_SIZE,
  }
}

function resampleLinear(samples, ratio) {
  const outputLength = Math.max(1, Math.round(samples.length / ratio))
  const output = new Float32Array(outputLength)
  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio
    const base = Math.floor(sourceIndex)
    const fraction = sourceIndex - base
    const left = samples[base] || 0
    const right = samples[base + 1] || left
    output[index] = left + (right - left) * fraction
  }
  return output
}

function computeLevel(samples) {
  let sumSquares = 0
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index] || 0
    sumSquares += value * value
  }
  const rms = samples.length > 0 ? Math.sqrt(sumSquares / samples.length) : 0
  return Math.min(1, rms * 10)
}

function float32ToInt16(samples) {
  const output = new Int16Array(samples.length)
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]))
    output[index] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
  }
  return output
}
