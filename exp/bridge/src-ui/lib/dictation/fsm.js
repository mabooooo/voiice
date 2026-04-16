// 连续听写 FSM：起点敏捷（PRE 阶段 96ms 即可确认进入 IN_SPEECH）、终点保守（POST 需要 700ms 才封包），
// 最短句 180ms 并加二重门控防止咳嗽、键盘噼啪被误认为指令；最长句 15s 防跑飞。
// 状态转移中涉及的所有时序参数都在 DEFAULT_CONFIG，方便一次性调优。

import { SILERO_FRAME_SIZE, SILERO_SAMPLE_RATE } from './silero.js'
import { RingBuffer } from './ringBuffer.js'

// 32ms 一帧（512 / 16000）。参数换算用得到，直接硬写减少运行时乘除。
const FRAME_DURATION_MS = (SILERO_FRAME_SIZE / SILERO_SAMPLE_RATE) * 1000
const SAMPLES_PER_MS = SILERO_SAMPLE_RATE / 1000

export const DEFAULT_CONFIG = Object.freeze({
  vadEnter: 0.45,           // 进入 PRE 的概率阈值
  vadExit: 0.30,            // 已在 speech 中维持的滞回下限
  preSpeechMs: 96,          // PRE→IN 所需的累计 speech 时长（约 3 帧）
  endSilenceMs: 700,        // POST 持续静音达到该值才正式封包
  minUtteranceMs: 180,      // 小于该长度且能量不够高时视为噪声
  minUtteranceRobustMs: 320,// 超过此长度无论如何都会发出，不再参与能量/概率门控
  maxUtteranceMs: 15000,    // 单句上限，超出强制切段
  preRollMs: 400,           // IN_SPEECH 开始时往前回补的音频时长
  noiseRmsFloor: 0.004,     // 静态噪声基线下限（约 -48dBFS）
  shortUtteranceEnergyMultiplier: 1.8, // 短片段保留门槛：RMS 需超过噪声基线 × 该倍数
  shortUtterancePeakProb: 0.70,        // 短片段保留门槛：VAD 峰值概率需超过该值
})

const PHASE = Object.freeze({
  IDLE: 'idle',
  PRE: 'pre',
  IN: 'in',
  POST: 'post',
})

// 常驻静音时自适应估计噪声 RMS，取 EMA 保证跟得上空调声涨落。
function updateNoiseFloor(prev, currentRms) {
  if (!Number.isFinite(prev) || prev === 0) return currentRms
  return prev * 0.95 + currentRms * 0.05
}

function computeRms(frame) {
  let sum = 0
  for (let i = 0; i < frame.length; i += 1) {
    sum += frame[i] * frame[i]
  }
  return Math.sqrt(sum / frame.length)
}

export function createDictationFSM(options = {}) {
  const config = { ...DEFAULT_CONFIG, ...(options.config || {}) }
  const logger = options.logger || (() => {})
  const onUtterance = options.onUtterance || (() => {})
  const onPhaseChange = options.onPhaseChange || (() => {})

  const preRollCapacity = Math.round(config.preRollMs * SAMPLES_PER_MS)
  const ring = new RingBuffer(preRollCapacity)

  // 单句缓冲：IN_SPEECH 中每帧追加到 utteranceBuffers；POST 期间的静音帧也临时累加，
  // 封包时按 keepSamples 截断到最后一帧真正 speech 后的时间戳，避免尾巴过长。
  const state = {
    phase: PHASE.IDLE,
    utteranceBuffers: [],      // 收到的原始 speech/silence 帧
    utteranceSamples: 0,       // buffers 累计的采样数，等价于长度
    speechEndSample: 0,        // 最后一帧判为 speech 时对应的采样位置
    preSpeechSpeechMs: 0,      // PRE 阶段累计 speech 时长
    postSilenceMs: 0,          // POST 阶段累计静音时长
    utteranceStartAt: 0,
    peakProb: 0,
    peakRms: 0,
    noiseRms: 0,
  }

  function setPhase(nextPhase, reason) {
    if (state.phase === nextPhase) return
    const prev = state.phase
    state.phase = nextPhase
    logger(`[dictation] phase ${prev} → ${nextPhase}${reason ? ` (${reason})` : ''}`)
    onPhaseChange({ from: prev, to: nextPhase, reason })
  }

  function resetUtterance() {
    state.utteranceBuffers = []
    state.utteranceSamples = 0
    state.speechEndSample = 0
    state.preSpeechSpeechMs = 0
    state.postSilenceMs = 0
    state.peakProb = 0
    state.peakRms = 0
    state.utteranceStartAt = 0
  }

  function beginUtterance() {
    // 把环形缓冲里保存的最近 preRollMs 采样拿出来做 pre-roll。
    const preRoll = ring.drainAll()
    resetUtterance()
    state.utteranceStartAt = performance.now()
    if (preRoll.length > 0) {
      state.utteranceBuffers.push(preRoll)
      state.utteranceSamples += preRoll.length
      state.speechEndSample = preRoll.length
    }
  }

  function emitUtterance(reason) {
    // 先按最后 speech 帧截断，避免保留无效的尾部静音。
    const keep = Math.min(state.speechEndSample, state.utteranceSamples)
    const durationMs = (keep / SILERO_SAMPLE_RATE) * 1000
    if (keep === 0) {
      logger(`[dictation] drop empty utterance (${reason})`)
      resetUtterance()
      return
    }

    const concatenated = concatenateFrames(state.utteranceBuffers, keep)
    const isShort = durationMs < config.minUtteranceRobustMs
    const rmsGate = Math.max(config.noiseRmsFloor, state.noiseRms * config.shortUtteranceEnergyMultiplier)
    if (durationMs < config.minUtteranceMs) {
      logger(`[dictation] drop too-short utterance ${durationMs.toFixed(0)}ms (${reason})`)
      resetUtterance()
      return
    }
    if (isShort) {
      // 短片段二重门控：能量必须明显超过噪声基线，且 VAD 峰值概率达到 0.7。
      if (state.peakRms < rmsGate || state.peakProb < config.shortUtterancePeakProb) {
        logger(`[dictation] drop noisy short utterance ${durationMs.toFixed(0)}ms rms=${state.peakRms.toFixed(4)}/${rmsGate.toFixed(4)} prob=${state.peakProb.toFixed(2)}`)
        resetUtterance()
        return
      }
    }

    logger(`[dictation] emit utterance ${durationMs.toFixed(0)}ms reason=${reason} prob=${state.peakProb.toFixed(2)} rms=${state.peakRms.toFixed(4)}`)
    try {
      onUtterance({
        samples: concatenated,
        sampleRate: SILERO_SAMPLE_RATE,
        durationMs,
        peakProb: state.peakProb,
        peakRms: state.peakRms,
        reason,
      })
    } catch (error) {
      logger(`[dictation] onUtterance threw: ${error.message || error}`)
    }
    resetUtterance()
  }

  function feed(prob, frame) {
    const rms = computeRms(frame)
    state.peakRms = Math.max(state.peakRms, rms)
    state.peakProb = Math.max(state.peakProb, prob)

    switch (state.phase) {
      case PHASE.IDLE: {
        state.noiseRms = updateNoiseFloor(state.noiseRms, rms)
        ring.push(frame)
        if (prob >= config.vadEnter) {
          setPhase(PHASE.PRE, 'vad-enter')
          state.preSpeechSpeechMs = FRAME_DURATION_MS
        }
        break
      }
      case PHASE.PRE: {
        ring.push(frame)
        if (prob >= config.vadExit) {
          state.preSpeechSpeechMs += FRAME_DURATION_MS
          if (state.preSpeechSpeechMs >= config.preSpeechMs) {
            beginUtterance()
            // pre-roll 已经把当前帧之前的内容吃进 buffer；本帧显式再 push 一次保持时序。
            pushUtteranceFrame(frame, true)
            setPhase(PHASE.IN, 'confirmed')
          }
        } else {
          // 跌回安静即回到 IDLE，不穷举短突发。
          setPhase(PHASE.IDLE, 'pre-dropout')
          state.preSpeechSpeechMs = 0
        }
        break
      }
      case PHASE.IN: {
        pushUtteranceFrame(frame, prob >= config.vadExit)
        const durationMs = (state.utteranceSamples / SILERO_SAMPLE_RATE) * 1000
        if (durationMs >= config.maxUtteranceMs) {
          emitUtterance('max-duration')
          setPhase(PHASE.IDLE, 'after-emit')
          break
        }
        if (prob < config.vadExit) {
          setPhase(PHASE.POST, 'vad-drop')
          state.postSilenceMs = FRAME_DURATION_MS
        }
        break
      }
      case PHASE.POST: {
        pushUtteranceFrame(frame, prob >= config.vadExit)
        const durationMs = (state.utteranceSamples / SILERO_SAMPLE_RATE) * 1000
        if (prob >= config.vadEnter) {
          // 小停顿后又说话：把静音吸进当前句继续累积，避免把"嗯……对"拆成两句。
          setPhase(PHASE.IN, 'post-reenter')
          state.postSilenceMs = 0
          break
        }
        state.postSilenceMs += FRAME_DURATION_MS
        if (state.postSilenceMs >= config.endSilenceMs) {
          emitUtterance('silence-timeout')
          setPhase(PHASE.IDLE, 'after-emit')
          break
        }
        if (durationMs >= config.maxUtteranceMs) {
          emitUtterance('max-duration')
          setPhase(PHASE.IDLE, 'after-emit')
        }
        break
      }
      default:
        break
    }
  }

  function pushUtteranceFrame(frame, isSpeech) {
    // 拷贝一份存下来，AudioWorklet 的缓冲会被复用。
    const copy = frame.slice(0)
    state.utteranceBuffers.push(copy)
    state.utteranceSamples += copy.length
    if (isSpeech) {
      state.speechEndSample = state.utteranceSamples
    }
  }

  // 外部主动停止：把正在进行中的句子 flush 出去，保证用户手动结束也能拿到最后一句。
  function flush(reason = 'manual') {
    if (state.phase === PHASE.IN || state.phase === PHASE.POST) {
      emitUtterance(reason)
    }
    ring.clear()
    setPhase(PHASE.IDLE, reason)
    resetUtterance()
  }

  function reset() {
    ring.clear()
    resetUtterance()
    state.noiseRms = 0
    setPhase(PHASE.IDLE, 'reset')
  }

  return {
    feed,
    flush,
    reset,
    getPhase: () => state.phase,
    getSnapshot: () => ({
      phase: state.phase,
      noiseRms: state.noiseRms,
      utteranceMs: (state.utteranceSamples / SILERO_SAMPLE_RATE) * 1000,
    }),
    frameDurationMs: FRAME_DURATION_MS,
    sampleRate: SILERO_SAMPLE_RATE,
  }
}

// 按目标采样数把多段帧拼成一整块 Float32Array；实现简单但避免了多次 concat。
function concatenateFrames(frames, sampleCount) {
  const out = new Float32Array(sampleCount)
  let offset = 0
  for (const chunk of frames) {
    if (offset >= sampleCount) break
    const take = Math.min(chunk.length, sampleCount - offset)
    out.set(take === chunk.length ? chunk : chunk.subarray(0, take), offset)
    offset += take
  }
  return out
}

export const DICTATION_PHASE = PHASE
