# 连续听写（Continuous Dictation）

连续听写模式让麦克风常驻开启，一句话说完就自动断句并送本地 SenseVoice 识别。识别结果继续喂给原有的语音点选 FSM（`点击 / 打开 + 关键词 + 数字`）。

这份文档给出当前迁移方向、完整链路、关键组件、参数、默认阈值、如何调优，便于后续维护时直接定位。

## 当前改造方向（2026-04）

这次改造先把连续听写从“renderer 内部完整闭环”拆成“两段式”：

- `renderer` 只负责麦克风采集、轻量级电平反馈、把 16k PCM 分块推给主进程。
- `main` 负责连续听写会话、静音断句、WAV 封包、调用 SenseVoice、再把文本送进现有 `voiceRouter`。
- SenseVoice 服务契约保持不变，仍然是“给一段 wav，返回一段文本”。

这么拆的原因很直接：

- WebAudio / AudioWorklet / ONNX runtime 全堆在 renderer 里时，链路跨浏览器栈和 Electron `file://` 环境，排查成本高。
- 麦克风采集本身在 renderer 最方便，但句子状态机、ASR 触发、动作路由更适合放在主进程做统一编排。
- 这样保留了“前端零权限采集音频”的边界，同时把真正影响稳定性的听写状态收回主进程。

旧的 renderer VAD/FSM 链路已经从代码中移除；当前文档只描述仍然存在的主进程连续听写方案。

## 一、端到端链路

```
┌ renderer ─────────────────────────────────────────────────────────────────┐
│                                                                           │
│  getUserMedia (mono / AGC,NS,EC off)                                      │
│          │                                                                │
│          ▼                                                                │
│  AudioContext + ScriptProcessor                                           │
│          │                                                                │
│          │  重采样到 16kHz，按 100ms 拼成一块 Float32 PCM                 │
│          ▼                                                                │
│  bridge:dictation-session-push-chunk({ sessionId, sampleRate, samples })  │
│                          │                                                 │
└──────────────────────────┼────────────────────────────────────────────────┘
                           │
┌ main ────────────────────▼───────────────────────────────────────────────┐
│  bridge:dictation-session-start / push-chunk / stop                      │
│                                                                          │
│  MainDictationSession                                                    │
│    1. 维护 pre-roll / 当前句缓存                                          │
│    2. 用自适应 RMS + peak + 尾部静音做轻量断句                           │
│    3. encodeWavPcm16(samples)                                            │
│    4. saveRecordingToTemp() -> os.tmpdir()/voice-bridge-recordings/*.wav │
│    5. handleVoiceAudioPayload()                                          │
│         - ensureManagedSenseVoiceServiceReady()                          │
│         - transcribeSenseVoiceAudio(filePath, { language })             │
│         - voiceRouter.handleTranscript(...)                             │
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
- **开启**：第一次按键 = `dictationStartSession()` + `startDictationPcmCapture()`；第二次按键 = 停止采集并 `dictationStopSession()`。

## 二、关键组件

### `src-ui/lib/dictation/pcmCapture.js`

renderer 侧采集器。职责只有三件事：

- `getUserMedia` 申请麦克风，关闭 AGC / NS / EC。
- 用 `AudioContext + ScriptProcessor` 读取原始音频，并重采样到 `16kHz mono`。
- 按固定 `100ms` chunk 通过 `bridge:dictation-session-push-chunk` 推给主进程。

它不再负责 VAD、断句、WAV 封包，也不直接触发 ASR。

### `src/dictationSession.mjs`

主进程连续听写会话管理器。它是当前链路的核心：

- `idle / in / post` 三态切换全部在主进程完成。
- `idle` 时持续维护 `pre-roll`，避免句首起音被截掉。
- 用 `noiseRms` 自适应更新噪声基线，再结合 `rms + peak` 判断是否进入/维持语音。
- 句尾通过 `END_SILENCE_MS` 判定封句；手动停止时会 flush 最后一句。
- 每句在主进程里直接编码成 `wav`，随后走既有 `SenseVoice -> voiceRouter` 链路。

这一层把“连续听写状态”从 renderer 收回到了主进程，便于排查和后续继续替换成更强的 VAD。

### `main.mjs`

主进程现在新增三组连续听写 IPC：

- `bridge:dictation-session-start`
- `bridge:dictation-session-push-chunk`
- `bridge:dictation-session-stop`

同时保留原有：

- `saveRecordingToTemp()`：统一把单句 WAV 落到系统临时目录。
- `handleVoiceAudioPayload()`：统一复用本地 ASR + 语音路由逻辑。
- `bridge:voice-handle-audio`：继续服务非连续听写场景，避免契约分叉。

### `preload.cjs`

新增 bridge API：

- `dictationStartSession`
- `dictationPushChunk`
- `dictationStopSession`
- `onDictationEvent`

### `src-ui/App.jsx`

UI 层的职责：

- 持久化 `dictationEnabled`（开关）和 `preferredLanguage`（首选语言）到 localStorage。
- 快捷键分流：`onRecordingToggle` 里按 `dictationEnabledRef.current` 选走"整段录音"还是"常驻听写"。
- 启动连续听写时先向主进程创建 session，再启动本地 PCM 采集。
- 通过 `onDictationEvent` 接收主进程回推的 `phase / queued / result / dropped / error / stopped` 事件，更新 UI 和 overlay。
- unmount 兜底：如果用户直接关窗口，`dictationHandleRef.current.stop()` 收回 getUserMedia track。

## 三、默认参数

| 参数 | 值 | 含义 |
| --- | --- | --- |
| `sampleRate` | `16000` | renderer 推给主进程的目标采样率 |
| `chunkDurationMs` | `100` | renderer 每次推送给主进程的 PCM 分块时长 |
| `preRollMs` | `240` | 主进程进入一句话前往回补的原始音频 |
| `endSilenceMs` | `680` | 尾部静音超过多久后封句 |
| `minUtteranceMs` | `220` | 小于该长度的句子直接丢弃 |
| `maxUtteranceMs` | `15000` | 单句上限，防跑飞 |
| `noiseRmsFloor` | `0.003` | 主进程噪声基线下限 |
| `enterMultiplier` | `2.4` | 进入语音时，RMS 相对噪声基线的放大倍数 |
| `exitMultiplier` | `1.7` | 维持语音时，RMS 相对噪声基线的放大倍数 |
| `enterPeakFloor` | `0.06` | 启动语音的 peak 兜底阈值 |
| `exitPeakFloor` | `0.04` | 维持语音的 peak 兜底阈值 |

调优建议：

- 环境偏吵：优先增大 `enterMultiplier` 或 `enterPeakFloor`，让主进程更保守地进入语音态。
- 用户说话节奏慢、停顿多：把 `endSilenceMs` 调到 `850~1000`，避免一句话被拆成多句。
- 经常漏掉很短的口语指令：把 `minUtteranceMs` 降到 `160~180`，同时观察误触发是否明显上升。

## 四、首选语言

SenseVoiceSmall 支持 `auto / zh / en / ja / ko / yue`。

- `auto`：先做一次 LID（语言识别）再解码。鲁棒，适合中英混说。
- 固定到单语言：跳过 LID，在单语场景下通常多 1~3% 精度。中英混说时固定 `zh` 可能把英文单词音译成汉字（`chrome → 克罗姆`）。

设置页下拉切换立即生效：下一次主进程封句后，就会带着新的 `language` 字段走 `handleVoiceAudioPayload() -> transcribeSenseVoiceAudio()`，再到服务端的 `resolve_request_language -> AutoModel.generate(language=...)`。服务端启动参数仍是默认兜底，用户设置缺失或非法时回落。

## 五、常见问题与排错

- **说话完全没有反应**：先看 renderer 是否有 `PCM capture ready`，再看主进程是否有 `session started` / `queue utterance`；前者没有说明采集没跑，后者没有说明主进程断句阈值没打到。
- **"嗯 / 对"经常被吞**：降低 `minUtteranceMs`，必要时同时降低 `enterMultiplier` 或 `enterPeakFloor`。
- **句子被拆成两段**：把 `endSilenceMs` 调大到 `900` 左右；或者用户语速很慢时增大 `maxUtteranceMs`。
- **麦克风被后台占用**：`stopDictationMode` 没有被调到。切换设置开关、或关闭窗口都会走 `dictationHandleRef.current.stop()` 释放。如果发现泄漏，检查 `useEffect` 卸载钩子。
- **终端日志太多**：当前已经关闭主进程高频 `phase -> ...` 日志，overlay 也只在文字语义变化时打印；若仍嫌多，可继续收敛 `speech start / drop short utterance / queue utterance` 这类诊断日志。

## 六、与现有链路的关系

| 入口 | 链路 |
| --- | --- |
| 开发者模式"开始录音 / 停止并导入" | MediaRecorder → webm → `analyzeAudioFile`（云端 LLM 动作解析） |
| 开发者模式"Local ASR Test" | MediaRecorder → webm → `transcribeSenseVoice`（独立测试，不做动作解析） |
| 全局快捷键 · 连续听写关闭 | MediaRecorder → webm → `voiceHandleAudio`（本地 ASR + 语音点选 FSM） |
| 全局快捷键 · 连续听写开启 | renderer PCM 采集 → main `MainDictationSession` 断句 → 每句 WAV → `voiceHandleAudio`（本地 ASR + 语音点选 FSM） |

云端 LLM 动作解析（Qwen / MiMo）当前只走"开发者模式 · 文件分析 / 开始录音"按钮，快捷键链路暂时只走本地 SenseVoice。后续若需要融合，可以在 `voiceHandleAudio` 里增加云端 fallback。
