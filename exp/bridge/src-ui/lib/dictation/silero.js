// Silero VAD 封装：在 renderer 内直接跑 ONNX 推理，按 512 采样（32ms）给出一个语音概率。
// 这里不做任何状态判断，让 FSM 层独立决定如何使用概率。
// ORT 走动态 import 从 public/ort/ 加载，避免 Vite 对 onnxruntime-web 的 import.meta.url
// 做重写导致 wasm 路径失控；所有资产都通过 npm run vendor:silero 落到 public/。
import { resolveDictationAssetUrl } from './assetUrl.js'

const ORT_MODULE_URL = resolveDictationAssetUrl('./ort/ort.min.mjs')
const MODEL_URL = resolveDictationAssetUrl('./silero_vad.onnx')
const WASM_PATHS = resolveDictationAssetUrl('./ort/')
const SAMPLE_RATE = 16000

let ortModule = null
let session = null
let initPromise = null
let stateMode = 'split'

async function loadOrt() {
  if (ortModule) return ortModule
  // @vite-ignore 让 Vite 不去解析这个路径，保持运行时从部署产物目录直接加载。
  ortModule = await import(/* @vite-ignore */ ORT_MODULE_URL)
  // onnxruntime-web 首次使用前把 wasm 目录告诉它，同时关闭多线程 / proxy，
  // 在 Electron 的 file:// 环境下最稳定。
  ortModule.env.wasm.wasmPaths = WASM_PATHS
  ortModule.env.wasm.numThreads = 1
  ortModule.env.wasm.proxy = false
  ortModule.env.logLevel = 'warning'
  return ortModule
}

async function ensureSession() {
  if (session) return session
  if (initPromise) return initPromise
  initPromise = (async () => {
    try {
      const ort = await loadOrt()
      const modelResponse = await fetch(MODEL_URL)
      if (!modelResponse.ok) {
        throw new Error(`加载 Silero VAD 模型失败: HTTP ${modelResponse.status}. 请先运行 npm run vendor:silero`)
      }
      const modelBuffer = await modelResponse.arrayBuffer()
      session = await ort.InferenceSession.create(modelBuffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      })
      // 新版官方模型输入是 input/state/sr；旧版模型仍可能是 input/h/c/sr。
      stateMode = session.inputNames?.includes('state') ? 'combined' : 'split'
      return session
    } catch (error) {
      initPromise = null
      throw error
    }
  })()
  return initPromise
}

// 状态张量兼容两种官方导出：
// 1. 旧版：h/c 两个输入，各自 (2,1,64)
// 2. 新版：单个 state 输入，形状 (2,1,128)
function createEmptyState(ort) {
  return {
    h: new ort.Tensor('float32', new Float32Array(2 * 1 * 64), [2, 1, 64]),
    c: new ort.Tensor('float32', new Float32Array(2 * 1 * 64), [2, 1, 64]),
    state: new ort.Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128]),
  }
}

export class SileroVad {
  constructor() {
    this.state = null
    this.sampleRate = null
    this.ready = false
  }

  async init() {
    await loadOrt()
    await ensureSession()
    this.state = createEmptyState(ortModule)
    this.sampleRate = new ortModule.Tensor('int64', BigInt64Array.from([BigInt(SAMPLE_RATE)]))
    this.ready = true
  }

  // 重置 LSTM 状态：句子结束或主动停听写时调用，避免把上一句的尾巴带进下一句。
  reset() {
    if (!ortModule) return
    this.state = createEmptyState(ortModule)
  }

  // 兼容新版单 state 输入：把 h/c 拼成 (2,1,128)。
  getCombinedStateTensor() {
    if (this.state.state) return this.state.state
    const combined = new Float32Array(2 * 1 * 128)
    combined.set(this.state.h.data, 0)
    combined.set(this.state.c.data, this.state.h.data.length)
    this.state.state = new ortModule.Tensor('float32', combined, [2, 1, 128])
    return this.state.state
  }

  // 接收 512 采样的 Float32 帧，返回 0~1 的语音概率。
  async process(frame) {
    if (!this.ready || !session || !ortModule) {
      throw new Error('SileroVad 未初始化')
    }
    const ort = ortModule
    const input = new ort.Tensor('float32', frame, [1, frame.length])
    const feeds = stateMode === 'combined'
      ? {
          input,
          sr: this.sampleRate,
          state: this.getCombinedStateTensor(),
        }
      : {
          input,
          sr: this.sampleRate,
          h: this.state.h,
          c: this.state.c,
        }
    const results = await session.run(feeds)
    // v4/v5 输出键名兼容处理：既有 "output" 也可能是 "prob"。
    const probTensor = results.output || results.prob || Object.values(results)[0]
    const prob = probTensor.data[0]
    if (results.hn) this.state.h = results.hn
    if (results.cn) this.state.c = results.cn
    if (results.stateN) {
      // 新版模型把状态合并成一个张量；同时回填 h/c，保持旧逻辑也可继续工作。
      const stateTensor = results.stateN
      this.state.state = stateTensor
      this.state.h = new ort.Tensor('float32', stateTensor.data.slice(0, 2 * 1 * 64), [2, 1, 64])
      this.state.c = new ort.Tensor('float32', stateTensor.data.slice(2 * 1 * 64), [2, 1, 64])
    }
    return prob
  }
}

export const SILERO_FRAME_SIZE = 512
export const SILERO_SAMPLE_RATE = SAMPLE_RATE
