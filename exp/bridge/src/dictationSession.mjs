const DEFAULT_SAMPLE_RATE = 16000
const PRE_ROLL_MS = 240
const END_SILENCE_MS = 680
const MIN_UTTERANCE_MS = 220
const MAX_UTTERANCE_MS = 15000
const NOISE_RMS_FLOOR = 0.003
const ENTER_MULTIPLIER = 2.4
const EXIT_MULTIPLIER = 1.7
const ENTER_RMS_FLOOR = 0.012
const EXIT_RMS_FLOOR = 0.008
const ENTER_PEAK_FLOOR = 0.06
const EXIT_PEAK_FLOOR = 0.04

// 主进程连续听写会话：
// 只接收 renderer 推来的 16k PCM，内部完成断句、封 WAV、ASR 和语音路由。
export class MainDictationSession {
  constructor({
    sessionId,
    language = 'auto',
    ocrBackend = 'ppocr',
    spatialMemoryEnabled = false,
    logger = () => {},
    emitEvent = () => {},
    saveRecording = async () => '',
    routeAudio = async () => ({}),
  } = {}) {
    this.sessionId = sessionId
    this.language = language
    this.ocrBackend = ocrBackend
    this.spatialMemoryEnabled = spatialMemoryEnabled
    this.logger = logger
    this.emitEvent = emitEvent
    this.saveRecording = saveRecording
    this.routeAudio = routeAudio

    this.sampleRate = DEFAULT_SAMPLE_RATE
    this.phase = 'idle'
    this.noiseRms = NOISE_RMS_FLOOR
    this.preRollChunks = []
    this.preRollSamples = 0
    this.utteranceChunks = []
    this.utteranceSamples = 0
    this.trailingSilenceSamples = 0
    this.utteranceSeq = 0
    this.pendingWork = Promise.resolve()
    this.stopped = false
  }

  // renderer 每推来一块 PCM，就在主进程里做一次轻量能量判定。
  pushChunk(rawSamples, sampleRate = DEFAULT_SAMPLE_RATE) {
    if (this.stopped) return
    const samples = normalizeFloat32Array(rawSamples)
    if (!samples.length) return
    this.sampleRate = Number.isFinite(sampleRate) ? sampleRate : DEFAULT_SAMPLE_RATE

    const stats = measureSamples(samples)
    this.handleFrame(samples, stats)
  }

  // 停止时会 flush 最后一句，并等待所有 ASR / 路由任务完成。
  async stop(reason = 'manual') {
    if (this.stopped) {
      await this.pendingWork
      return
    }

    this.stopped = true
    if (this.utteranceSamples > 0) {
      this.finalizeUtterance(reason, { trimTrailingSilence: true })
    } else {
      this.setPhase('idle', reason)
    }

    await this.pendingWork
    this.emit('stopped', { reason })
    this.log(`session stopped reason=${reason}`)
  }

  handleFrame(samples, stats) {
    const enterSpeech = isSpeechFrame(stats, this.getEnterThreshold(), ENTER_PEAK_FLOOR)
    const keepSpeech = isSpeechFrame(stats, this.getExitThreshold(), EXIT_PEAK_FLOOR)

    if (this.phase === 'idle') {
      this.pushPreRoll(samples)
      if (!enterSpeech) {
        this.updateNoiseFloor(stats)
        return
      }
      this.beginUtterance(samples)
      this.setPhase('in', 'speech-start')
      return
    }

    if (this.phase === 'in') {
      this.appendUtterance(samples, { isSpeech: keepSpeech })
      if (keepSpeech) {
        if (this.getUtteranceDurationMs() >= MAX_UTTERANCE_MS) {
          this.finalizeUtterance('max-duration')
        }
        return
      }
      this.setPhase('post', 'silence-start')
      if (this.getUtteranceDurationMs() >= MAX_UTTERANCE_MS) {
        this.finalizeUtterance('max-duration')
      }
      return
    }

    if (keepSpeech) {
      this.appendUtterance(samples, { isSpeech: true })
      this.setPhase('in', 'speech-resume')
      if (this.getUtteranceDurationMs() >= MAX_UTTERANCE_MS) {
        this.finalizeUtterance('max-duration')
      }
      return
    }

    this.appendUtterance(samples, { isSpeech: false })
    if (this.getTrailingSilenceMs() >= END_SILENCE_MS) {
      this.finalizeUtterance('end-silence')
    }
  }

  beginUtterance(firstSpeechChunk) {
    // 开句时先把 pre-roll 拼进去，减少“点/开”这类短起音被截掉。
    this.utteranceChunks = this.preRollChunks.map(chunk => chunk.slice(0))
    this.utteranceSamples = this.preRollSamples
    this.trailingSilenceSamples = 0
    this.preRollChunks = []
    this.preRollSamples = 0
    this.appendUtterance(firstSpeechChunk, { isSpeech: true })
    this.log(`speech start rms=${measureSamples(firstSpeechChunk).rms.toFixed(4)} noise=${this.noiseRms.toFixed(4)}`)
  }

  appendUtterance(samples, { isSpeech }) {
    this.utteranceChunks.push(samples.slice(0))
    this.utteranceSamples += samples.length
    this.trailingSilenceSamples = isSpeech ? 0 : (this.trailingSilenceSamples + samples.length)
  }

  finalizeUtterance(reason, { trimTrailingSilence = true } = {}) {
    const totalSamples = this.utteranceSamples
    if (totalSamples <= 0) {
      this.resetUtteranceState()
      this.setPhase('idle', 'empty')
      return
    }

    const trimmedTrailingSamples = trimTrailingSilence ? this.trailingSilenceSamples : 0
    const effectiveSamples = Math.max(0, totalSamples - trimmedTrailingSamples)
    const durationMs = samplesToMs(effectiveSamples, this.sampleRate)
    const merged = mergeChunks(this.utteranceChunks, effectiveSamples)

    this.resetUtteranceState()
    this.setPhase('idle', reason)

    if (durationMs < MIN_UTTERANCE_MS || merged.length === 0) {
      this.log(`drop short utterance reason=${reason} duration=${durationMs.toFixed(0)}ms`)
      this.emit('dropped', { reason, durationMs })
      return
    }

    const seq = ++this.utteranceSeq
    this.log(`queue utterance #${seq} reason=${reason} duration=${durationMs.toFixed(0)}ms samples=${merged.length}`)
    this.emit('queued', { seq, reason, durationMs })

    this.pendingWork = this.pendingWork.then(async () => {
      const wav = encodeWavPcm16(merged, this.sampleRate)
      const filePath = await this.saveRecording({
        bytes: wav,
        mimeType: 'audio/wav',
      })
      const result = await this.routeAudio({
        filePath,
        language: this.language,
        ocrBackend: this.ocrBackend,
        spatialMemoryEnabled: this.spatialMemoryEnabled,
      })
      this.emit('result', {
        seq,
        durationMs,
        filePath,
        transcript: result?.transcript || '',
        action: result?.routed?.action || (result?.routed?.handled ? 'handled' : 'no-trigger'),
        phase: result?.state?.phase || 'idle',
      })
      this.log(`utterance #${seq} done transcript="${String(result?.transcript || '').trim()}"`)
    }).catch((error) => {
      const message = String(error?.message || error)
      this.emit('error', { stage: 'route', message })
      this.log(`utterance route failed: ${message}`)
    })
  }

  pushPreRoll(samples) {
    const maxSamples = msToSamples(PRE_ROLL_MS, this.sampleRate)
    this.preRollChunks.push(samples.slice(0))
    this.preRollSamples += samples.length
    while (this.preRollSamples > maxSamples && this.preRollChunks.length > 0) {
      const oldest = this.preRollChunks[0]
      const overflow = this.preRollSamples - maxSamples
      if (oldest.length <= overflow) {
        this.preRollChunks.shift()
        this.preRollSamples -= oldest.length
        continue
      }
      this.preRollChunks[0] = oldest.slice(overflow)
      this.preRollSamples -= overflow
    }
  }

  updateNoiseFloor(stats) {
    // 只在 idle 阶段更新噪声基线，避免把真实语音误吸进 noise floor。
    const next = Math.max(NOISE_RMS_FLOOR, stats.rms)
    this.noiseRms = this.noiseRms * 0.92 + next * 0.08
  }

  getEnterThreshold() {
    return Math.max(ENTER_RMS_FLOOR, this.noiseRms * ENTER_MULTIPLIER)
  }

  getExitThreshold() {
    return Math.max(EXIT_RMS_FLOOR, this.noiseRms * EXIT_MULTIPLIER)
  }

  getUtteranceDurationMs() {
    return samplesToMs(this.utteranceSamples, this.sampleRate)
  }

  getTrailingSilenceMs() {
    return samplesToMs(this.trailingSilenceSamples, this.sampleRate)
  }

  setPhase(nextPhase, reason = '') {
    if (this.phase === nextPhase) return
    this.phase = nextPhase
    this.emit('phase', { phase: nextPhase, reason })
  }

  resetUtteranceState() {
    this.utteranceChunks = []
    this.utteranceSamples = 0
    this.trailingSilenceSamples = 0
  }

  emit(type, payload = {}) {
    this.emitEvent({
      type,
      sessionId: this.sessionId,
      ...payload,
    })
  }

  log(message) {
    this.logger(`[dictation-main] ${message}`)
  }
}

function normalizeFloat32Array(value) {
  if (value instanceof Float32Array) return value
  if (ArrayBuffer.isView(value)) return new Float32Array(value.buffer, value.byteOffset, value.byteLength / Float32Array.BYTES_PER_ELEMENT)
  if (Array.isArray(value)) return Float32Array.from(value)
  return new Float32Array(0)
}

function measureSamples(samples) {
  let sumSquares = 0
  let peak = 0
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] || 0
    const abs = Math.abs(sample)
    if (abs > peak) peak = abs
    sumSquares += sample * sample
  }
  return {
    rms: samples.length > 0 ? Math.sqrt(sumSquares / samples.length) : 0,
    peak,
  }
}

function isSpeechFrame(stats, rmsThreshold, peakThreshold) {
  return stats.rms >= rmsThreshold || stats.peak >= peakThreshold
}

function mergeChunks(chunks, keepSamples) {
  const targetLength = Math.max(0, keepSamples)
  const merged = new Float32Array(targetLength)
  let offset = 0
  for (const chunk of chunks) {
    if (offset >= targetLength) break
    const take = Math.min(chunk.length, targetLength - offset)
    merged.set(chunk.subarray(0, take), offset)
    offset += take
  }
  return merged
}

function msToSamples(ms, sampleRate) {
  return Math.round((ms / 1000) * sampleRate)
}

function samplesToMs(samples, sampleRate) {
  return (samples / Math.max(1, sampleRate)) * 1000
}

// 主进程直接编码 WAV，保持 SenseVoice 仍然只接收“单句 wav 文件”。
function encodeWavPcm16(samples, sampleRate) {
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8)
  const blockAlign = numChannels * (bitsPerSample / 8)
  const dataSize = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let index = 0; index < samples.length; index += 1, offset += 2) {
    const clamped = Math.max(-1, Math.min(1, samples[index]))
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
  }

  return new Uint8Array(buffer)
}

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index))
  }
}
