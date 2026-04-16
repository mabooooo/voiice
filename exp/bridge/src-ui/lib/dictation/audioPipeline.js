// 连续听写音频管线：
//   getUserMedia (16kHz mono) → AudioWorklet (512 采样/帧) → Silero VAD → FSM → onUtterance
// 管线自身不做任何磁盘/网络操作，调用方拿到 Float32 samples 后负责封 WAV、落盘、送 ASR。
// 只允许同时存在一个实例；重复 start 需先 stop。
import { SileroVad, SILERO_SAMPLE_RATE } from './silero.js'
import { resolveDictationAssetUrl } from './assetUrl.js'
import { createDictationFSM, DEFAULT_CONFIG } from './fsm.js'

const WORKLET_URL = resolveDictationAssetUrl('./vad-worklet.js')
const FRAME_SIZE = 512
const WORKLET_FIRST_FRAME_TIMEOUT_MS = 1200
const WORKLET_MIN_FRAME_COUNT = 4
const WORKLET_MIN_ACTIVE_SPAN_MS = 160

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

// 全局快捷键来自主进程 IPC，不一定能被浏览器当成用户手势。
// 这里显式 resume，避免 AudioContext 卡在 suspended 导致 Worklet/VAD 完全不跑。
async function ensureAudioContextRunning(context, logger) {
  if (!context) return
  logger(`[dictation] AudioContext state=${context.state}`)
  if (context.state === 'running') return
  try {
    await context.resume()
  } catch (error) {
    logger(`[dictation] AudioContext resume 失败: ${error.message || error}`)
    throw error
  }
  logger(`[dictation] AudioContext resumed -> state=${context.state}`)
  if (context.state !== 'running') {
    throw new Error(`AudioContext 未进入 running，当前状态=${context.state}`)
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 连续听写优先走 AudioWorklet；若 Electron/file:// 下只收到首帧或完全不回调，
// 自动回退到 ScriptProcessor，避免整条听写链路卡死。
async function attachFrameDriver({ context, source, logger, onFrame }) {
  const silentSink = context.createGain()
  silentSink.gain.value = 0
  silentSink.connect(context.destination)

  const disconnectNode = (node) => {
    try { node.disconnect() } catch {}
  }

  const createFrameEmitter = (tag) => {
    let firstFrameSeen = false
    return (rawFrame) => {
      if (!firstFrameSeen) {
        firstFrameSeen = true
        logger(`[dictation] first frame received via ${tag} samples=${rawFrame?.length || 0}`)
      }
      onFrame(rawFrame)
    }
  }

  const workletResult = await tryAttachAudioWorklet({
    context,
    source,
    silentSink,
    logger,
    onFrame: createFrameEmitter('worklet'),
  })
  if (workletResult) {
    return {
      sourceType: 'worklet',
      cleanup: () => {
        try { workletResult.node.port.onmessage = null } catch {}
        try { workletResult.node.onprocessorerror = null } catch {}
        disconnectNode(source)
        disconnectNode(workletResult.node)
        disconnectNode(silentSink)
      },
    }
  }

  logger('[dictation] 回退到 ScriptProcessor 取帧')
  const scriptNode = context.createScriptProcessor(2048, 1, 1)
  const emitFrame = createFrameEmitter('script-processor')
  const frameBuffer = new Float32Array(FRAME_SIZE)
  let writeOffset = 0
  scriptNode.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0)
    const output = event.outputBuffer.getChannelData(0)
    output.fill(0)
    let readOffset = 0
    while (readOffset < input.length) {
      const remaining = FRAME_SIZE - writeOffset
      const takeCount = Math.min(remaining, input.length - readOffset)
      frameBuffer.set(input.subarray(readOffset, readOffset + takeCount), writeOffset)
      writeOffset += takeCount
      readOffset += takeCount
      if (writeOffset >= FRAME_SIZE) {
        emitFrame(frameBuffer.slice(0))
        writeOffset = 0
      }
    }
  }
  source.connect(scriptNode)
  scriptNode.connect(silentSink)
  return {
    sourceType: 'script-processor',
    cleanup: () => {
      scriptNode.onaudioprocess = null
      disconnectNode(source)
      disconnectNode(scriptNode)
      disconnectNode(silentSink)
    },
  }
}

async function tryAttachAudioWorklet({ context, source, silentSink, logger, onFrame }) {
  try {
    await context.audioWorklet.addModule(WORKLET_URL)
  } catch (error) {
    logger(`[dictation] AudioWorklet 加载失败，改走 ScriptProcessor: ${error.message || error}`)
    return null
  }

  const workletNode = new AudioWorkletNode(context, 'vad-frame-processor', {
    numberOfInputs: 1,
    // Worklet 必须接到一条真实输出链路上，浏览器才会持续拉取 process()。
    numberOfOutputs: 1,
    channelCount: 1,
  })

  let frameCount = 0
  let firstFrameAt = 0
  let lastFrameAt = 0
  workletNode.onprocessorerror = () => {
    logger('[dictation] AudioWorklet processor error，改走 ScriptProcessor')
  }
  workletNode.port.onmessage = (event) => {
    frameCount += 1
    const now = performance.now()
    if (!firstFrameAt) firstFrameAt = now
    lastFrameAt = now
    onFrame(event.data)
  }

  source.connect(workletNode)
  workletNode.connect(silentSink)
  await ensureAudioContextRunning(context, logger)
  await wait(WORKLET_FIRST_FRAME_TIMEOUT_MS)

  const activeSpanMs = firstFrameAt && lastFrameAt ? (lastFrameAt - firstFrameAt) : 0
  if (frameCount >= WORKLET_MIN_FRAME_COUNT && activeSpanMs >= WORKLET_MIN_ACTIVE_SPAN_MS) {
    logger(`[dictation] AudioWorklet 活跃 frameCount=${frameCount} span=${activeSpanMs.toFixed(0)}ms`)
    return { node: workletNode }
  }

  logger(`[dictation] AudioWorklet 帧数不足 frameCount=${frameCount} span=${activeSpanMs.toFixed(0)}ms，改走 ScriptProcessor`)
  try { workletNode.port.onmessage = null } catch {}
  try { workletNode.onprocessorerror = null } catch {}
  try { source.disconnect(workletNode) } catch {}
  try { workletNode.disconnect() } catch {}
  return null
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
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
  })
  const audioTrack = mediaStream.getAudioTracks()[0]
  const trackSettings = audioTrack?.getSettings?.() || {}
  logger(`[dictation] track settings rate=${trackSettings.sampleRate || 'unknown'} channels=${trackSettings.channelCount || 'unknown'} device=${trackSettings.deviceId || 'default'}`)

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

  const source = context.createMediaStreamSource(mediaStream)

  // 设备采样率偏离 16kHz 时要做线性重采样；实际 ratio 多数情况下是 1 或 3（48k→16k）。
  const ratio = context.sampleRate / SILERO_SAMPLE_RATE
  const needsResample = Math.abs(ratio - 1) > 1e-3
  if (needsResample) {
    logger(`[dictation] context rate=${context.sampleRate}Hz, 重采样到 ${SILERO_SAMPLE_RATE}Hz (ratio=${ratio.toFixed(3)})`)
  }

  let stopped = false
  let processingCount = 0
  const frameDriver = await attachFrameDriver({
    context,
    source,
    logger,
    onFrame: async (rawFrame) => {
      if (stopped) return
      try {
        const frame16k = needsResample ? resampleLinear(rawFrame, ratio, SILERO_SAMPLE_RATE) : rawFrame
        // Silero 期望固定 512 采样；重采样后若长度不匹配按尾部裁剪 / 零补到 512。
        const frame = ensureFrameSize(frame16k, FRAME_SIZE)
        processingCount += 1
        const prob = await vad.process(frame)
        fsm.feed(prob, frame)
      } catch (error) {
        logger(`[dictation] frame 处理失败: ${error.message || error}`)
        onError?.(error)
      } finally {
        processingCount = Math.max(0, processingCount - 1)
      }
    },
  })
  logger(`[dictation] frame source=${frameDriver.sourceType}`)

  const stop = async ({ flushReason = 'stop' } = {}) => {
    if (stopped) return
    stopped = true
    try { frameDriver.cleanup() } catch {}
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
