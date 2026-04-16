// 连续听写音频管线：
//   getUserMedia (16kHz mono) → AudioWorklet (512 采样/帧) → Silero VAD → FSM → onUtterance
// 管线自身不做任何磁盘/网络操作，调用方拿到 Float32 samples 后负责封 WAV、落盘、送 ASR。
// 只允许同时存在一个实例；重复 start 需先 stop。
import { SileroVad, SILERO_SAMPLE_RATE } from './silero.js'
import { createDictationFSM, DEFAULT_CONFIG } from './fsm.js'

const WORKLET_URL = './vad-worklet.js'

// 构造 AudioContext 时显式指定采样率；Chrome/Electron 不支持非原生采样率时会抛错，
// 这里 fallback 到系统默认采样率，由后续的重采样步骤补位。
async function createAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) throw new Error('当前环境缺少 AudioContext')
  try {
    return new AudioContextClass({ sampleRate: SILERO_SAMPLE_RATE })
  } catch {
    return new AudioContextClass()
  }
}

export async function startDictationPipeline({
  deviceId,
  onUtterance,
  onPhaseChange,
  onError,
  logger = () => {},
  vadConfig,
} = {}) {
  if (typeof onUtterance !== 'function') {
    throw new Error('startDictationPipeline 需要 onUtterance 回调')
  }

  // 麦克风约束保持与主录音一致，避免 AGC/NS 把短促的"对""嗯"压掉。
  const mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      autoGainControl: false,
      noiseSuppression: false,
      echoCancellation: false,
      channelCount: 1,
      sampleRate: SILERO_SAMPLE_RATE,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
  })

  let context
  try {
    context = await createAudioContext()
  } catch (error) {
    mediaStream.getTracks().forEach((track) => track.stop())
    throw error
  }

  const vad = new SileroVad()
  try {
    await vad.init()
  } catch (error) {
    mediaStream.getTracks().forEach((track) => track.stop())
    try { await context.close() } catch {}
    throw error
  }

  // 首次预热一次 512 采样，把 ONNX 图 JIT 和算子缓存填上，避免首帧 200ms 延迟。
  try { await vad.process(new Float32Array(512)) } catch {}
  vad.reset()

  const fsm = createDictationFSM({
    config: vadConfig,
    logger,
    onUtterance,
    onPhaseChange,
  })

  try {
    await context.audioWorklet.addModule(WORKLET_URL)
  } catch (error) {
    mediaStream.getTracks().forEach((track) => track.stop())
    try { await context.close() } catch {}
    throw new Error(`加载 AudioWorklet 失败: ${error.message || error}`)
  }

  const source = context.createMediaStreamSource(mediaStream)
  const workletNode = new AudioWorkletNode(context, 'vad-frame-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
  })

  // 设备采样率偏离 16kHz 时要做线性重采样；实际 ratio 多数情况下是 1 或 3（48k→16k）。
  const ratio = context.sampleRate / SILERO_SAMPLE_RATE
  const needsResample = Math.abs(ratio - 1) > 1e-3
  if (needsResample) {
    logger(`[dictation] context rate=${context.sampleRate}Hz, 重采样到 ${SILERO_SAMPLE_RATE}Hz (ratio=${ratio.toFixed(3)})`)
  }

  let stopped = false
  let processingCount = 0

  workletNode.port.onmessage = async (event) => {
    if (stopped) return
    try {
      const rawFrame = event.data
      const frame16k = needsResample ? resampleLinear(rawFrame, ratio, SILERO_SAMPLE_RATE) : rawFrame
      // Silero 期望固定 512 采样；重采样后若长度不匹配按尾部裁剪 / 零补到 512。
      const frame = ensureFrameSize(frame16k, 512)
      processingCount += 1
      const prob = await vad.process(frame)
      fsm.feed(prob, frame)
    } catch (error) {
      logger(`[dictation] frame 处理失败: ${error.message || error}`)
      onError?.(error)
    } finally {
      processingCount = Math.max(0, processingCount - 1)
    }
  }

  source.connect(workletNode)

  const stop = async ({ flushReason = 'stop' } = {}) => {
    if (stopped) return
    stopped = true
    try { workletNode.port.onmessage = null } catch {}
    try { source.disconnect() } catch {}
    try { workletNode.disconnect() } catch {}
    mediaStream.getTracks().forEach((track) => track.stop())
    // 等一轮微任务把队列里的最后帧处理完，再 flush 可能遗留的 IN_SPEECH。
    await Promise.resolve()
    fsm.flush(flushReason)
    try { await context.close() } catch {}
    vad.reset()
  }

  return {
    stop,
    getPhase: () => fsm.getPhase(),
    getSnapshot: () => fsm.getSnapshot(),
    getConfig: () => ({ ...DEFAULT_CONFIG, ...(vadConfig || {}) }),
    get inFlight() { return processingCount },
  }
}

// 保持 512 采样窗口：AudioWorklet 每次产出 512，理论上重采样后也应接近 512；稍有偏差时补齐。
function ensureFrameSize(frame, targetSize) {
  if (frame.length === targetSize) return frame
  if (frame.length > targetSize) return frame.subarray(0, targetSize)
  const padded = new Float32Array(targetSize)
  padded.set(frame, 0)
  return padded
}

// 朴素线性插值重采样；48k → 16k 时只每 3 个样本取一个加权平均，已足够给 VAD 用。
function resampleLinear(frame, ratio, targetRate) {
  void targetRate
  const outLength = Math.round(frame.length / ratio)
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i += 1) {
    const srcIndex = i * ratio
    const base = Math.floor(srcIndex)
    const frac = srcIndex - base
    const a = frame[base] || 0
    const b = frame[base + 1] || a
    out[i] = a + (b - a) * frac
  }
  return out
}
