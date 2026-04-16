# 连续听写（Continuous Dictation）

连续听写模式让麦克风常驻开启，本地 VAD 检测端点，一句话说完就自动断句并送本地 SenseVoice 识别。识别结果继续喂给原有的语音点选 FSM（`点击 / 打开 + 关键词 + 数字`）。

这份文档给出完整链路、关键组件、参数、默认阈值、如何调优，便于后续维护时直接定位。

## 一、端到端链路

```
┌ renderer ─────────────────────────────────────────────────────────────────┐
│                                                                           │
│  getUserMedia (16kHz / mono / AGC,NS,EC off)                              │
│          │                                                                │
│          ▼                                                                │
│  AudioContext  →  AudioWorkletNode (vad-frame-processor)                  │
│                        │                                                  │
│                        │  每 512 采样 (32ms) post 一次 Float32 帧         │
│                        ▼                                                  │
│                 [ Silero VAD (onnxruntime-web / wasm) ]                   │
│                        │  → prob ∈ [0,1]                                  │
│                        ▼                                                  │
│          ┌────────────── Dictation FSM ──────────────┐                    │
│          │ idle → pre → in → post → idle             │                    │
│          │   (同时维护 RingBuffer + 当前句 buffer)   │                    │
│          └───────────────────────────────────────────┘                    │
│                        │  每封一句输出 Float32 samples                    │
│                        ▼                                                  │
│                 encodeWavPcm16 → Uint8Array                               │
│                        │                                                  │
│                        ▼                                                  │
│      window.bridgeApi.saveRecording(bytes, mime)  ── IPC ──┐              │
│                                                            │              │
└────────────────────────────────────────────────────────────┼──────────────┘
                                                             │
┌ main ───────────────────────────────────────────────────── ▼──────────────┐
│  saveRecordingToTemp → os.tmpdir()/voice-bridge-recordings/*.wav          │
│                                                                           │
│  bridge:voice-handle-audio({filePath, language, ocrBackend, ...})         │
│    1. ensureManagedSenseVoiceServiceReady()                               │
│    2. transcribeSenseVoiceAudio(filePath, { language })                   │
│    3. voiceRouter.handleTranscript(transcript, { backend, spatialMemory })│
│                                                                           │
│  voiceRouter (src/voiceActionRouter.mjs) 的外层 FSM：                     │
│    idle → await_selection（带数字 1-9 / 一到九）                          │
│         → click_at / clickWindowPoint                                     │
└───────────────────────────────────────────────────────────────────────────┘
                                                             │
┌ service ──────────────────────────────────────────────────── ▼────────────┐
│  FastAPI + FunASR + SenseVoiceSmall                                       │
│  TranscribeRequest.language ∈ {auto, zh, en, ja, ko, yue} 可 per-request  │
│  覆盖启动参数。                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

完整控制流：用户按下全局快捷键（默认右 `Alt`）→ `main.mjs` 的 `shortcutManager` 通过 `bridge:recording-toggle` 推给 renderer → renderer 根据"连续听写开关"分流：

- **关闭（默认）**：保持 0.0.8 引入的"按一次开始 MediaRecorder 录音、再按一次停止并整段上传"原始链路，本地不做 VAD / 分帧 / 任何处理。
- **开启**：第一次按键 = `startDictationPipeline()`；第二次按键 = `handle.stop()`。

## 二、关键组件

### `public/vad-worklet.js`

AudioWorkletProcessor。职责：把 AudioContext 默认的 128 采样 quantum 聚合成 512 采样帧（Silero VAD 原生窗口尺寸）并通过 `port.postMessage` 推送给主线程。实现刻意保持最薄，不做任何 DSP。

### `src-ui/lib/dictation/silero.js`

Silero VAD 的 ES 封装。

- ONNX runtime 从 `public/ort/ort.min.mjs` 动态 import（`@vite-ignore`），彻底避开 Vite 对 `import.meta.url` 的重写。`wasmPaths = './ort/'`，`numThreads=1`，`proxy=false`，只用 CPU wasm backend，在 Electron `file://` 下最稳。
- 单例 `InferenceSession`，跨整个听写会话复用。
- `process(frame512)` 每次返回一个概率；LSTM 状态 `h / c` 在实例内部维护，`reset()` 清零。

### `src-ui/lib/dictation/ringBuffer.js`

Float32 环形缓冲区。只做一件事：始终保存最近 `preRollMs`（默认 400ms）的原始音频。当 FSM 从 `pre → in` 确认进入一句话时，`drainAll()` 把这段 pre-roll 拼到当前句最前面，避免吃字（"开"、"点"这类塞音容易被切掉）。

### `src-ui/lib/dictation/fsm.js`

薄状态机，纯函数式接口。

**状态与转移**：

| 状态 | 含义 | 转移 |
| --- | --- | --- |
| `idle` | 待机 | prob ≥ `vadEnter` → `pre` |
| `pre` | 疑似语音中 | 累计 speech 时长 ≥ `preSpeechMs` → `in`（此时 `beginUtterance()`，拼入 pre-roll）；prob < `vadExit` → `idle` |
| `in` | 句中 | prob < `vadExit` → `post`；句长 ≥ `maxUtteranceMs` → 强制封包 |
| `post` | 句尾静音等待确认 | prob ≥ `vadEnter` → 回 `in`（吸回小停顿，例："嗯……对"不被拆开）；累计静音 ≥ `endSilenceMs` → 封包 `emitUtterance()` |

**双缓冲**：

- RingBuffer（`preRollMs` 采样，默认 6400）：始终在 `idle / pre` 阶段持续 push；`in` 阶段不再 push（已经开始写 utteranceBuffer 了）。
- utteranceBuffer（`state.utteranceBuffers` + `utteranceSamples`）：从 `in` 进入开始累积；`post` 阶段的静音也临时累加，封包时按最后一次 speech 帧的 offset 截断，避免尾部静音过长。

**短句门控**：

- `<180ms`（`minUtteranceMs`）：一律丢弃。
- `180~320ms`（`minUtteranceMs ~ minUtteranceRobustMs`）：需要 `peakProb ≥ 0.70` 且 `peakRms > noiseRms × 1.8` 才保留。这一层专门给"对 / 不对 / 好 / 可以 / 嗯 / 同意"这类极短指令用。
- `>320ms`：一律保留。

**噪声自适应**：`idle` 状态下用 EMA 更新 `noiseRms`（因子 0.95），跟得上空调、风扇声的慢速涨落。

### `src-ui/lib/dictation/wavEncoder.js`

Float32 `[-1, 1]` → 16-bit PCM mono WAV（44 字节头 + 采样）。零依赖、零外部分配。输出 `Uint8Array` 直接交给 `bridge:save-recording` 落到 `os.tmpdir()/voice-bridge-recordings/`。

### `src-ui/lib/dictation/audioPipeline.js`

管线编排器。`startDictationPipeline({ deviceId, onUtterance, onPhaseChange, onError, logger, vadConfig })` 负责：

1. `getUserMedia` 拿到 16kHz mono 流，关 AGC / NS / EC。
2. 建 AudioContext。Electron 拒绝非原生采样率时 fallback 到默认采样率，再做线性重采样回 16kHz。
3. 加载 AudioWorklet + 挂上 Silero VAD + FSM。
4. 首次运行一次全零 512 采样做 warmup，消除首帧 ~200ms 冷启动延迟。
5. 返回 `{ stop, getPhase, getSnapshot, inFlight }`。

`stop()` 时：断开 source/worklet、停掉 track、`close()` AudioContext、`fsm.flush()` 把正在进行中的句子 emit 出去，保证用户手动结束也能拿到最后一句。

### `src-ui/App.jsx`

UI 层的职责：

- 持久化 `dictationEnabled`（开关）和 `preferredLanguage`（首选语言）到 localStorage。
- 快捷键分流：`onRecordingToggle` 里按 `dictationEnabledRef.current` 选走"整段录音"还是"常驻听写"。
- `handleDictationUtterance({ samples, ... })` 每句独立执行：Float32 → WAV → `saveRecording` → `voiceHandleAudio`，结果回填到 `transcript` 状态和执行日志。
- unmount 兜底：如果用户直接关窗口，`dictationHandleRef.current.stop()` 收回 getUserMedia track。

## 三、默认参数

| 参数 | 值 | 含义 |
| --- | --- | --- |
| `vadEnter` | `0.45` | `idle → pre` 阈值。调高 = 抗噪更强但会漏掉弱开头；调低 = 更敏捷但可能被风扇/呼吸触发 |
| `vadExit` | `0.30` | `in / post` 中维持 speech 的滞回下限，比 `vadEnter` 低避免频繁抖动 |
| `preSpeechMs` | `96` | `pre → in` 需要的累计 speech 时长（约 3 帧）。短一点更敏捷但易被突发噪声带偏 |
| `endSilenceMs` | `700` | 尾部静音超过多久才封包。偏保守，避免把"我说…… 打开微信"中间的停顿拆掉 |
| `minUtteranceMs` | `180` | 小于该长度无条件丢弃 |
| `minUtteranceRobustMs` | `320` | 短句门控上界；更短的需要能量 / 概率双达标 |
| `maxUtteranceMs` | `15000` | 单句上限，防跑飞 |
| `preRollMs` | `400` | 从 `in` 开始往回补多少原始音频 |
| `noiseRmsFloor` | `0.004` | 静态噪声基线的硬下限（约 -48dBFS） |
| `shortUtteranceEnergyMultiplier` | `1.8` | 短句 RMS 需要超过 `noiseRms × 该值` 才算信号 |
| `shortUtterancePeakProb` | `0.70` | 短句 VAD 峰值概率需要超过该值 |

调优建议：

- 环境偏吵（开放式工位、空调出风口）：`vadEnter ↑ 到 0.55`、`shortUtterancePeakProb ↑ 到 0.80`，同时把 `shortUtteranceEnergyMultiplier` 提到 `2.2` 左右。
- 用户说话节奏慢、停顿多：`endSilenceMs ↑ 到 900~1000`，避免一句话被拆成两句。
- 经常有极短口语指令（"对"/"嗯"）漏掉：`minUtteranceMs ↓ 到 150`，同时把 `shortUtterancePeakProb` 降到 `0.60` 观察误触发。

## 四、首选语言

SenseVoiceSmall 支持 `auto / zh / en / ja / ko / yue`。

- `auto`：先做一次 LID（语言识别）再解码。鲁棒，适合中英混说。
- 固定到单语言：跳过 LID，在单语场景下通常多 1~3% 精度。中英混说时固定 `zh` 可能把英文单词音译成汉字（`chrome → 克罗姆`）。

设置页下拉切换立即生效：下一次 `handleDictationUtterance` 就会带着新的 `language` 字段走 IPC → `transcribeSenseVoiceAudio` → 服务端的 `resolve_request_language` → `AutoModel.generate(language=...)`。服务端启动参数仍是默认兜底，用户设置缺失或非法时回落。

## 五、常见问题与排错

- **启动报 "加载 Silero VAD 模型失败"**：跑 `npm run vendor:silero` 先把 `public/silero_vad.onnx` 和 `public/ort/*` 准备好；它们都会通过 `npm run build:renderer` 拷贝到 `renderer-dist/`。
- **AudioWorklet 加载失败**：检查 `renderer-dist/vad-worklet.js` 是否存在；没有就是 `public/` 没被 Vite 带进来。
- **"嗯 / 对"经常被吞**：降低 `shortUtterancePeakProb` 到 `0.6`，或降低 `minUtteranceMs` 到 `150`；同时检查 `peakRms` 日志确认麦克风电平是否太低。
- **句子被拆成两段**：`endSilenceMs` 调大到 `900`；或者用户语速很慢时增大 `maxUtteranceMs`。
- **麦克风被后台占用**：`stopDictationMode` 没有被调到。切换设置开关、或关闭窗口都会走 `dictationHandleRef.current.stop()` 释放。如果发现泄漏，检查 `useEffect` 卸载钩子。

## 六、与现有链路的关系

| 入口 | 链路 |
| --- | --- |
| 开发者模式"开始录音 / 停止并导入" | MediaRecorder → webm → `analyzeAudioFile`（云端 LLM 动作解析） |
| 开发者模式"Local ASR Test" | MediaRecorder → webm → `transcribeSenseVoice`（独立测试，不做动作解析） |
| 全局快捷键 · 连续听写关闭 | MediaRecorder → webm → `voiceHandleAudio`（本地 ASR + 语音点选 FSM） |
| 全局快捷键 · 连续听写开启 | AudioWorklet + Silero VAD + FSM → 每句 WAV → `voiceHandleAudio`（本地 ASR + 语音点选 FSM） |

云端 LLM 动作解析（Qwen / MiMo）当前只走"开发者模式 · 文件分析 / 开始录音"按钮，快捷键链路暂时只走本地 SenseVoice。后续若需要融合，可以在 `voiceHandleAudio` 里增加云端 fallback。
