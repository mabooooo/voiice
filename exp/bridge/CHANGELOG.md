# Changelog

## 0.0.24 坐标换算封装 + 点击定位收口

### Added

- 新增 [src/screenCoordinates.mjs](D:/Projects/AI/voiice/exp/bridge/src/screenCoordinates.mjs)，集中封装整屏截图、窗口截图、窗口相对记忆与点击落点之间的坐标换算。
- 新增 `mapWindowImageRect()`、`mapFullScreenImageRect()`、`globalLogicalRectToRelative()`、`relativeRectToWindowLocal()` 与 `buildClickTargetFromSpaces()`，把“物理像素 / 逻辑像素 / overlay 坐标 / 点击坐标”统一到同一套工具函数。

### Changed

- `main.mjs` 的空间记忆命中、窗口 OCR 和整屏 OCR 结果现在统一走 `screenCoordinates.mjs`，不再在业务代码里分别手写缩放和坐标换算。
- `voiceActionRouter` 现在只消费 `mapImageRectToSpaces()` 返回的空间信息，再由 `buildClickTargetFromSpaces()` 组装候选点击目标，路由层不再关心具体坐标空间。
- 空间记忆回写时，窗口 OCR 命中的矩形改为先还原到全局逻辑坐标，再统一转成窗口相对比例，减少不同入口下记忆格式不一致的问题。

### Fixed

- 修复窗口 OCR、空间记忆点击与候选高亮之间各自维护坐标换算时容易出现的重复逻辑和偏移风险。
- 修复高缩放场景下，窗口内候选中心点、空间记忆命中点与最终点击落点不完全一致的问题；现在窗口点击统一以窗口截图物理像素中心为准。

## 0.0.23 焦点窗口 OCR + 连续听写窗口高亮

### Added

- 连续听写新增“当前焦点窗口”黄色高亮框：进入 `listening` 后会在焦点窗口外侧显示 `1px` 黄色边框，并在底部居中显示“当前窗口”标签。
- 主进程新增 `captureAndOcrFocusedWindow()`，支持先截图当前焦点窗口，再在窗口坐标系内执行 OCR。
- 主进程新增 `mapCapturedWindowRectToLogical()`，统一把“窗口截图物理像素”换算成“窗口内逻辑坐标 + 全局逻辑坐标”，供高亮、点击和空间记忆复用。
- `voiceActionRouter` 新增 `VERB_POLICY` 与 `mapOcrPicksToCandidates()`，把触发词语义和不同 OCR 坐标空间的候选映射集中收口。

### Changed

- “打开 / open + 关键词” 现在默认只对当前焦点窗口做 OCR；“点击 / 点一下 / 点下 / click + 关键词” 仍保持整屏 OCR。
- 候选映射逻辑现在同时支持“整屏 OCR”与“窗口 OCR”两种坐标空间，窗口候选会优先走“窗口句柄 + 窗口内局部坐标”点击。
- 连续听写期间的窗口高亮改为主进程轮询焦点窗口，并通过常驻透明指示层增量更新，不再复用一次性高亮的展示方式。
- `extractTrigger()` 不再直接硬编码 `scope`，改为先抽取 `verb + keyword`，再通过 `VERB_POLICY` 决定 OCR 范围，便于后续扩展更多触发动词。
- README 新增 TODO，记录 overlay 后续迁移到 sidecar overlay 的计划，并补充 macOS 下透明点击穿透 overlay 的实现约束。

### Fixed

- 修复连续听写停止后，已在路上的焦点窗口刷新任务仍可能把高亮框重新画出来的问题；现在通过 revision 保护丢弃过期刷新结果。
- 修复高 DPI / 显示器缩放场景下窗口截图只截到左上角一部分的问题；窗口截图脚本在抓图前会先显式提升 DPI awareness。
- 修复窗口 OCR 与空间记忆点击在高缩放桌面下的局部坐标偏移问题；窗口内点击现在统一使用物理像素 offset。

## 0.0.22 主进程连续听写会话 + 日志降噪

### Added

- 新增 [src/dictationSession.mjs](D:/Projects/AI/voiice/exp/bridge/src/dictationSession.mjs)，由主进程接管连续听写会话，负责 `pre-roll`、轻量断句、WAV 封包、SenseVoice 调用和语音路由。
- 新增 [src-ui/lib/dictation/pcmCapture.js](D:/Projects/AI/voiice/exp/bridge/src-ui/lib/dictation/pcmCapture.js)，renderer 现在只负责麦克风 PCM 采集、重采样到 `16kHz`，并按固定 chunk 推给主进程。
- preload 新增 `dictationStartSession / dictationPushChunk / dictationStopSession / onDictationEvent`，用于跨进程连续听写会话。

### Changed

- 连续听写链路从“renderer 内 VAD/FSM/WAV”改为“renderer 采集 PCM -> main 断句 -> 每句 WAV -> `voiceHandleAudio`”，把句子状态和 ASR 触发统一收口到主进程。
- `main.mjs` 新增 `bridge:dictation-session-start / push-chunk / stop` IPC，并把本地语音入口收口到 `handleVoiceAudioPayload()`，避免连续听写和普通右 `Alt` 路径维护两套 ASR 路由逻辑。
- [docs/voice-dictation.md](D:/Projects/AI/voiice/exp/bridge/docs/voice-dictation.md) 更新为当前主进程连续听写架构，补充了新边界、参数和排查方式。
- overlay 日志现在只在 `status / title / subtitle` 发生实际变化时打印，不再因电平刷新而在终端重复刷屏。
- renderer -> main 的连续听写 IPC 音频块从 `Float32` 改为 `Int16`，降低带宽占用；主进程收到后再转回 `Float32` 做 RMS / peak 判定。
- 主进程短句门控新增 `160~220ms + peakRms` 放行逻辑，减少“嗯 / 对 / 好”这类短应答被整体吞掉。
- 主进程 `pre-roll` 从 `240ms` 上调到 `320ms`，减少“点击 / 打开”这类起音被截短后影响 ASR 的概率。

### Removed

- 删除旧的 renderer 内连续听写实现：`audioPipeline / silero / fsm / ringBuffer / assetUrl / wavEncoder`。
- 删除不再需要的 `public/vad-worklet.js`、`public/silero_vad.onnx`、`public/ort/` 以及 `vendor:silero` 脚本。
- 移除 `onnxruntime-web` 依赖，避免继续为已下线的旧链路安装和分发 ORT 资源。

### Fixed

- 修复连续听写在 renderer 中能采到麦克风、但无法稳定进入 ASR 的问题，现改为由主进程统一完成断句和单句提交。
- 修复连续听写终端日志过多的问题，关闭了主进程高频 `phase -> in/post/idle` 诊断日志，只保留启动、封句、结果和错误等高价值日志。

## 0.0.21 连续听写 + 首选语言

### Added

- 新增 renderer 侧连续听写管线 `src-ui/lib/dictation/`，由 `audioPipeline → silero (VAD) → fsm → wavEncoder` 组成一条纯本地的"VAD 端点检测 + 自动断句"链路。
- 新增 `public/vad-worklet.js`：AudioWorklet 把 128 采样 quantum 聚合成 `512 采样 / 32ms` 帧，推送给主线程做 VAD 推理。
- 新增 Silero VAD 离线资产：`npm run vendor:silero` 会下载 `silero_vad.onnx` 并把 `onnxruntime-web` 的 `.wasm / .mjs` 同步到 `public/ort/`。
- 新增薄 FSM：`idle → pre → in → post → idle`，参数见 `fsm.js` 的 `DEFAULT_CONFIG`；起点敏捷（`vadEnter=0.45`、`preSpeechMs=96`），终点保守（`endSilenceMs=700`、`preRollMs=400`、`maxUtteranceMs=15s`）。
- 新增双缓冲：`RingBuffer` 保存最近 `400ms` 原始音频用于 pre-roll；`utteranceBuffer` 在 `in/post` 阶段累积当前句，封包时按最后一次 speech 帧截断尾部静音。
- 新增短句二重门控：`<180ms` 直接丢弃；`180~320ms` 需满足 `VAD 峰值 ≥ 0.70 且 RMS > 噪声基线 × 1.8` 才保留，用于稳定留下"对 / 不对 / 好 / 可以 / 嗯 / 同意"这类极短指令，同时滤掉咳嗽、键盘噼啪。
- 新增首选语言设置（`auto / zh / en / ja / ko / yue`），持久化到 `localStorage`，每句识别请求都带上。
- 设置页新增"连续听写"开关与"首选语言"下拉，说明文案同步给出 auto 与固定语言的取舍。
- 新增文档 [docs/voice-dictation.md](D:/Projects/AI/voiice/exp/bridge/docs/voice-dictation.md)，记录端到端链路、参数取值、常见调优方向。

### Changed

- 全局快捷键（默认右 `Alt`）行为现在按"连续听写"开关分流：
  - 关闭时保持原始"按一次开始录音，再按一次结束并整段上传"链路，本地不做任何实时处理。
  - 开启时第一次按键进入常驻听写；每封一个端点就独立 `saveRecording → voiceHandleAudio`；再按一次退出。
- `bridge:voice-handle-audio` 与 `transcribeSenseVoiceAudio` 现在会透传 `language` 字段到本地 SenseVoice 服务。
- [capabilities/sensevoice/service/server.py](D:/Projects/AI/voiice/exp/bridge/capabilities/sensevoice/service/server.py) 支持 per-request `language` 覆盖：白名单 `auto / zh / en / ja / ko / yue`，非法值回落到启动默认。
- 渲染层构建输出新增 `renderer-dist/silero_vad.onnx`、`renderer-dist/ort/`、`renderer-dist/vad-worklet.js`，以便 Electron `file://` 环境下 ES 动态导入。

### Notes

- 连续听写模式使用的 MediaStream 与现有"按键录音"完全独立：关闭 AGC/NS/EC，固定 `16kHz mono`，与 Silero VAD 的原生采样率对齐；设备采样率不等于 16kHz 时做线性重采样。
- VAD 推理固定走 `wasm` backend + `numThreads=1 + proxy=false`，在 Electron `file://` 下最稳定；首帧会用全零帧预热一次，避免 JIT 带来的首 ~200ms 延迟。
- 当前所有 UI 仍只展示 ASR 转写文本；后续如果要给用户即时反馈 FSM 阶段，可以直接消费 `audioPipeline.getSnapshot().phase`。

## 0.0.20 空间记忆
- 新增 [src/appSpatialMemoryStore.mjs](D:/Projects/AI/voiice/exp/bridge/src/appSpatialMemoryStore.mjs)，以“应用 -> 窗口 -> 记忆”结构管理本地点选空间记忆，并落盘到 `.runtime/app-spatial-memory.json`。
- 设置页新增“空间记忆”开关，默认开启；主进程会返回记忆模块的 `appCount / windowCount / memoryCount / filePath` 供界面展示。

## 0.0.19 语音 OCR 点选路由 + PP-OCR 托管启动

### Added

- 新增 [src/voiceActionRouter.mjs](D:/Projects/AI/voiice/exp/bridge/src/voiceActionRouter.mjs)，以依赖注入方式实现语音点选 FSM，状态为 `idle / await_selection`，并带 `15s` 超时自动重置。
- `voiceActionRouter` 新增 `extractTrigger / extractSelectionIndex / pickCandidates`，支持“点击 / 点一下 / 打开 / open / click + 关键词”、`1-9 / 一二三 / 第X个` 以及按 OCR 行做最多 `9` 个候选排序。
- `src/windowsController.mjs` 新增白名单动作 `click_at {x,y}`，通过 `SetCursorPos + mouse_event` 执行物理像素级单击。
- 主进程新增 `bridge:voice-handle-audio`、`bridge:voice-route-text`、`bridge:voice-reset` 与 `bridge:voice-log`，分别用于 ASR+FSM 路由、无麦调试、状态清理与日志推送。
- preload 新增 `voiceHandleAudio / voiceRouteText / voiceReset / onVoiceLog` 暴露给渲染层。
- 新增 `src/rapidOcrClient.mjs`，直接复用 `.runtime/rapidocr_test.py` 验证过的 Win 原生 OCR `detect + recognize` 链路，作为语音点选的可选快速后端。
- 设置页新增“语音点选 OCR 后端”开关，可在 `RapidOCR` 与原有 `PP-OCR` 之间切换，且会持久化到本地存储。

### Changed

- `main.mjs` 新增 PP-OCR 托管能力：`startManagedPPOcrService / ensureReady / warmupPPOcr / stopManagedPPOcrService`，与 SenseVoice 采用同一套启动、探活和退出回收模式。
- Electron 启动时会自动拉起本地 PP-OCR 服务并用 `1x1 PNG` 触发一次 warmup，尽量把模型加载前移到启动阶段。
- 指示层 HTML/CSS 扩展为支持 `indicator--numbered` 与 `.indicator__badge`，可在目标屏幕上显示带编号的青色候选框和黄色数字徽章。
- 新增 `captureAndOcrPrimaryDisplay`：固定抓取主屏原始 PNG，再调用 PP-OCR，并返回 `scaleFactor + originX/Y`，为点击映射与多屏拼接提供统一坐标基础。
- 新增 `renderCandidateHighlights`：只在目标 `displayId` 的指示层绘制候选框，并由 FSM 控制清理时机，不再在渲染后自动清空。
- `src-ui/App.jsx` 中，右 `Alt` 快捷键停止录音后的链路改为 `analyzeAudioFile -> routeVoiceAudio`，优先走本地 `SenseVoice + FSM`；原云端 LLM 动作解析暂时从快捷键链路中移除。
- 手动文件分析与按钮触发的分析链路仍保持原有云端解析方式，便于后续平滑合并。
- Execution Log 现已订阅 `onVoiceLog`，会回显本地点选状态与步骤日志。
- `click_at` 在执行前显式声明 DPI aware，再调用 `SetCursorPos`，用于修正高缩放桌面下语音点选确认后鼠标落点偏移的问题。
- 语音路由日志从一次性候选坐标调试，调整为分阶段耗时日志，现会带时间戳输出截图、PP-OCR、候选筛选、高亮与点击等步骤完成信息，便于定位 OCR 慢点。
- 常规语音调试日志已收敛，只保留 `capture completed` 与 `ppocr completed` 两段带时间戳的耗时输出，减少终端噪音。
- 语音点选在只有 `1` 个候选时会直接点击；只有候选数大于 `1` 时才进入确认态等待序号。
- 编号徽章改为显示在候选框右侧，若超出屏幕右边缘则自动切换到左侧。
- 候选框会在原有 OCR 框基础上居中外扩 `20px` padding，提升可见性与容错。
- 右 `Alt` 触发的本地点选链路现在会按设置页选择切换 OCR 后端；默认仍保留原有 `PP-OCR`，切到 `RapidOCR` 后会直接调用本地测试脚本链路。
- 语音耗时日志改为按实际后端输出 `capture completed` 与 `ppocr completed / rapidocr completed`，便于对比两条 OCR 链路的瓶颈位置。
- 新增“空间记忆优先”分支：当当前前台窗口里存在对应关键词记忆时，先截图该窗口的小区域做 OCR；若命中则直接点击，失败后再回退到原来的整屏 OCR 链路。
- 空间记忆保存不再直接信任整屏 OCR 的坐标换算，而是在点击后重新截当前窗口并在窗口坐标系内复做一次 OCR，减少高缩放桌面下的记忆偏移。
- 空间记忆命中后的点击不再走整屏全局坐标推算，而是改为“窗口句柄 + 窗口内局部坐标”点击，复用 `GetWindowRect` 与 `SetCursorPos`，降低多显示器和 DPI 缩放下的偏移风险。
- 空间记忆命中后不再再次回写记忆，避免每次命中都重复刷新同一条记录。

### Notes

- 截图坐标采用物理像素，Overlay 绘制采用逻辑像素，点击坐标使用 `display.nativeOrigin + bbox center` 回到物理像素，避免 DPI 缩放下点击偏移。
- 当前推荐流程为：启动应用后自动托管 PP-OCR，按右 `Alt` 说“点击开发者模式”，屏幕出现编号候选框，再说“3”或“第三个”完成点击。
- 无麦调试可直接在渲染进程 console 调用：`bridgeApi.voiceRouteText({ transcript: '点击开发者模式' })`。
- 空间记忆当前主要服务于“同一应用、同一窗口标题、同一关键词”的重复点击场景；如果窗口标题或布局明显变化，仍会自动回退到整屏 OCR。

## 0.0.18 开发者模式窗口高亮指示

### Added

- 开发者模式的窗口列表每一项右侧新增“高亮”按钮，可直接在目标窗口边框位置显示黄色线框。
- preload 与主进程新增 `highlightWindow` IPC，支持按窗口句柄或直接按窗口坐标触发高亮。

### Changed

- 原有角标指示器重构为长期驻留、启动即预热、鼠标穿透的透明高亮层，避免首次点击时创建窗口带来的明显延迟。
- 高亮层在 `3s` 后只清空内部线框内容，不再反复 `hide/show` 透明窗口，减少系统动画干扰。
- 窗口高亮优先复用前端已拿到的窗口 `bounds`，避免每次点击都重新做一次 PowerShell 窗口枚举。
- 多显示器场景下，副屏高亮改为按系统真实拼接原点 `nativeOrigin` 计算定位，不再错误复用 Electron 逻辑 `bounds.x/y`。
- 窗口详情页新增“截图窗口”按钮，截图前会先把目标窗口调到前台；优先通过 `PrintWindow` 抓取窗口内容，失败后再回退为前台窗口的屏幕区域裁剪，并保存到本地截图目录。

## 0.0.17 PP-OCRv5 mobile 本地能力 + 开发者模式测试面板

### Added

- 新增 `capabilities/ppocr`，包含本地部署说明、`setup.ps1`、`start.ps1` 与 FastAPI 适配服务。
- 开发者模式新增 `PP-OCRv5 Mobile` 测试面板，可自动抓取主屏截图并调用本地 OCR 服务。
- preload 与主进程新增 PP-OCR 探活、主屏截图测试 IPC。
- PP-OCR 标注图会回写到截图目录，文件名后缀为 `-ppocr.png`。

### Changed

- `main.mjs` 抽出通用标注图保存逻辑，OmniParser 与 PP-OCR 共用同一套截图落盘方式。
- `.env.example` 与 README 补充 `PPOCR_BASE_URL`、部署步骤和能力目录说明。

## 0.0.16 SenseVoice Small 本地能力与并行识别

### Added

- 新增 `capabilities/sensevoice`，包含 `SenseVoice Small` 的本地部署脚本、说明文档与 FastAPI 适配服务。
- 新增 `capability:sensevoice:setup` 与 `capability:sensevoice:start` npm 脚本。
- preload 与主进程新增 `SenseVoice` 探活、本地转写 IPC。
- 设置页新增 `SenseVoice` 本地识别独立开关与服务检测入口。
- 分析页新增本地 `SenseVoice` 转写结果与耗时展示。
- Electron 启动时默认自动托管本机 `SenseVoice` 服务，并在退出时回收托管子进程。
- 开发者模式新增独立的本地 ASR 测试面板，可切换 `流式 / 非流式`，并支持 `VAD` 开关。

### Changed

- 音频分析流程现在可以在原有云端动作解析继续执行的同时，并行触发一次本地 `SenseVoice` 识别。
- `.env.example` 新增 `SENSEVOICE_BASE_URL / SENSEVOICE_AUTOSTART / SENSEVOICE_DEVICE`，统一配置本地 `SenseVoice` 服务地址、自动启动和推理设备。
- 本地音频预处理增加 `force wav` 选项，减少不同识别后端对压缩音频格式的兼容差异。

## 0.0.15 OmniParser 本地能力目录 + 开发者模式测试面板

### Added

- 新增 `capabilities/` 目录，作为 `bridge` 下统一承载本地能力部署脚本与适配层的入口。
- 新增 `capabilities/omniparser`，包含本地部署说明、`setup.ps1`、`start.ps1` 与 FastAPI 适配服务。
- 开发者模式新增 `OmniParser` 测试面板，可自动抓取主屏截图并调用本地 OmniParser 服务。
- preload 与主进程新增 OmniParser 探活、主屏截图测试 IPC。

### Changed

- `.env.example` 新增 `OMNIPARSER_BASE_URL`，统一配置本地 OmniParser 服务地址。
- README 补充本地能力目录规范与 OmniParser 部署步骤。
- OmniParser 部署从 `conda + 官方仓库 + caption 权重` 调整为 `项目内 .venv + 项目内缓存 + 检测版服务`。
- 当前 OmniParser 只使用新仓库里的 `icon_detect`，不再下载或依赖 `icon_caption_blip2 / icon_caption_florence`。
- OmniParser 服务改为 `icon detect + OCR` 的轻量适配实现，依赖与缓存默认落在 `capabilities/omniparser/.local/` 下，尽量减少对 `C:` 盘的占用。

## 0.0.14 当前焦点窗口接入与窗口管理组件拆分 + 获取UI树 + safe json

### Added

- 窗口快照新增当前焦点窗口识别，主进程会返回 `focusedWindow` 并在窗口项上标记 `isFocused`。
- LLM 上下文新增“当前焦点窗口”简要描述，并与窗口列表一起发给模型，帮助模型理解当前前台状态。
- 窗口管理面板新增“当前焦点窗口”展示，并在列表中高亮当前焦点窗口。
- 窗口详情新增“获取UI”能力，可按窗口句柄被动读取 UI Automation 控件树、常用属性和 Pattern 状态。

### Changed

- 右侧窗口管理能力从 `App.jsx` 中拆出，收敛为独立组件 `src-ui/features/window-management/WindowManagementPanel.jsx`，便于后续维护和扩展。
- 窗口详情、窗口移动和窗口动作执行逻辑改为由独立窗口管理组件内聚处理，减少主页面职责混杂。

## 0.0.13 Xiaomi thinking 配置补齐

### Changed

- Xiaomi MiMo 请求现在会在最终请求 body 根层额外补齐 `thinking.type = disable`，避免仅传 `enable_thinking: false` 时的兼容问题。
- README 补充 Xiaomi provider 的使用说明，明确请求 body 需要关闭 thinking。
- 语音链路和手动文本指令链路都会按当前 UI 选择的 provider 发起请求。
- 主进程 `get-config-status` 现在会返回两套 provider 的状态，供前端设置页展示。
- 语音分析链路固定使用非流式模式，不再从 UI 暴露流式开关。
- 调试与运行逻辑统一按 `enable_thinking: false`、`stream: false` 执行，减少状态分支。

### Added

- 新增统一 provider 配置模块，支持 `qwen / xiaomi` 两套 `apiKey / baseURL / model` 分发。
- `.env.example` 新增 Xiaomi MiMo 相关配置项：`XIAOMI_MIMO_API_KEY / XIAOMI_MIMO_BASE_URL / XIAOMI_MIMO_MODEL`。
- 设置页新增 endpoint 选择器，可在 `Qwen` 和 `Xiaomi MiMo` 间切换，并显示当前 provider 的模型、baseURL 和配置状态。

## 0.0.12 多屏桌面工具、屏幕指示器与耳机录音优化

### Added

- 新增多屏桌面截图能力，支持按显示器分别保存完整截图。
- 新增 `640P` 压缩截图能力，压缩时保持纵横比并限制高度不超过 `640`。
- 新增桌面截图主进程模块 `src/desktopCapture.mjs`，统一处理多屏抓取、预览图和落盘。
- 新增截图冒烟脚本 `scripts/smoke-screenshot.mjs`，用于验证多屏截图与压缩截图是否真实生成。
- 新增屏幕角标指示器能力，可在每块屏幕的 `25% / 75%` 四个定位点显示 `300px` 黄色边框，并在 `3` 秒后自动消失。
- 设置页新增耳机录音提示文案，提醒优先使用“系统默认输入设备”或外置麦克风。

### Changed

- 开发者模式新增“Desktop Analysis”截图面板，支持直接触发完整截图和压缩截图，并展示每块屏幕的预览、尺寸、体积与本地路径。
- 右侧实验操作区新增“屏幕指示器”按钮，用于触发各屏幕同步显示的黄色边框指示层。
- 屏幕指示器实现从“每屏 4 个独立窗口”改为“每屏 1 个透明层窗口内部绘制 4 个框”，减少窗口数量与合成开销，并改为全部准备完成后同步显示。
- 桌面相关 UI 组件从 `App.jsx` 中拆出，收敛到通用目录 `src-ui/features/desktop-utilities/`，便于后续在非开发者页面复用。
- 截图和屏幕指示器组件文件顶部补充了简短中文说明，说明职责与复用意图。

### Fixed

- 修复开发者模式中桌面截图能力只考虑主屏幕的问题，现已支持多屏分别抓取。
- 修复按下录音快捷键时可能误锁定到某个耳机麦克风设备的问题，未显式选择设备时现在保持“系统默认输入设备”。
- 录音采集约束关闭浏览器默认的自动增益、降噪和回声消除，减少耳机播放音量与音色被二次干预的概率。
- 当当前输入设备名称疑似耳机麦克风时，日志会给出提示，便于用户快速定位“听歌时音量异常”问题。

## 0.0.11 合并音频链路，input_text 改为剪贴板粘贴，Prompt 改为多行 Markdown 函数说明

### Changed

- `input_text` 不再逐字模拟键盘输入，改为“写入剪贴板 + 发送 Ctrl+V”。
- 这样可以避开中文输入法和键盘布局导致的字符偏差，提升中文文本输入稳定性。
- 语音分析入口不再先走 `transcribeCommandAudio` 再走 `parseIntentWithWindows`。
- 现在会把 `音频 + 文本 prompt + 最新窗口列表` 一次性发给模型，直接返回 `stt + plan`。
- `parseIntentWithWindows` 的用户 prompt 改为多行模板字符串，后续调整更直接。
- 函数说明改为 Markdown 列表，并把关键使用约束直接挂在各函数条目下，减少规则和函数定义分离造成的歧义。
- 当 LLM 已成功返回合法 JSON 且 `plan` 为空时，不再继续走本地规则 fallback，避免空结果误触发 `open_app`。
- 手动文本指令仍保留纯文本解析链路，不受这次变更影响。

### Fixed

- 每次发送语音前，主进程都会先刷新一次窗口快照，再把最新窗口列表传给 LLM。
- 手动文本指令在匹配前也会强制刷新窗口快照，避免和语音链路使用不同步的窗口状态。

## 0.0.10 窗口 id 兼容、函数集简化与 PowerShell 清洗

### Added

- 新增 `input` 动作语义，模型现在可以直接返回需要写入焦点输入框的文本内容。

### Changed

- 将模型可选函数收敛为更短的 canonical names：`focus_current`、`close_current`、`focus_window`、`close_window`、`input_text`、`open_app`、`send_shortcut`。
- LLM 提示词改为单独列出函数名称和最小参数格式，减少 token 占用并提高函数选择准确率。
- UI 中删除"转写提示词"，转写阶段改为固定内置 prompt，只做音频转文字。
- 执行态悬浮卡片的副标题改为优先显示模型返回的 `.stt` 字段，而不是动作列表。
- 手动文本指令和 fallback 规则路径现在也会回填 `stt`，保持执行态展示一致。
- 内部输入动作 helper 命名统一收敛到 `input_text` 语义，减少旧命名残留。

### Fixed

- 修复 LLM 返回 `focus_window({id:"W14"})` / `close_window({id:"W14"})` 时未被识别的问题，执行层现在同时兼容 `id / shortId / handle`。
- 修复窗口动作因 `id` 未命中而误回退到本地规则、最终错误执行 `open_app` 的问题。
- PowerShell 错误输出现在会清洗 CLIXML 与"正在准备首次使用模块"进度噪音，只保留可读错误正文。
- 执行态悬浮卡片继续保留 `.stt` 展示，同时 `input_text` 与旧输入动作统一收敛到同一执行路径。


## 0.0.9 左侧导航栏+麦克风选择

### Added

- 新增左侧导航栏，支持在"开发者模式"和"设置"之间切换。
- 设置页新增麦克风输入设备选择与刷新能力，录音时会优先使用选中的设备。

### Changed

- 现有实验控制界面整体纳入"开发者模式"菜单，不再把设置和调试内容混在同一层布局中。
- 设置页集中承载全局录音键和输入设备配置，减少右侧操作区的混杂信息。

### Fixed

- 修复选择麦克风输入设备后开始录音又回退到默认设备的问题。
- 设备列表刷新现在会优先保留用户显式选中的输入设备，不再被刷新逻辑覆盖。
- 修复通过全局 `Alt` 启动录音时仍读取旧输入设备状态的问题。
- 快捷键启动与手动点击录音现在统一读取最新的麦克风设备引用，不再出现"按钮录音正常、快捷键录音走错设备"的分叉。


## 0.0.8

### Added

- 新增原生全局键盘钩子 `uiohook-napi`，替代单独依赖 Electron `globalShortcut` 的修饰键触发方式。
- 右侧新增"设置 / 全局录音键"面板，支持按键识别、保存生效和查看最近识别/触发状态。
- 新增桌面底部悬浮录音状态窗，支持 `idle / listening / waiting / executing` 四种状态。
- 新增全局 `Alt / AltGr` 录音切换尝试，按下开始录音，再按一次停止。
- 录音态新增实时音量柱形反馈，柱形高度会随麦克风输入变化。
- 执行态新增更接近通知卡片的结果面板，用于展示最终执行的命令说明。

### Changed

- 底部悬浮窗重做为更接近灵动岛的黑色胶囊形态，空闲/录音/等待/执行四种状态的视觉反馈重新设计。
- 窗口列表重新显示 `W01 / W02` 这类短编号，便于和 LLM 侧窗口参数保持一致。
- 重新设计底部状态窗的三种核心形态：录音中、处理中、执行结果分别采用独立布局，不再共用同一套胶囊结构。
- 所有状态图标、字号和胶囊尺寸整体收小，减少当前悬浮窗的视觉压迫感。
- 录音分析完成后默认直接执行，不再依赖前端批准开关。
- 等待服务器返回、执行动作完成等状态会同步展示到悬浮状态窗，并在执行完成 4 秒后自动回到静息态。

### Fixed

- 修复 Windows 下"右 Alt 没有反应"的问题，录音切换改走原生全局键盘事件。
- 设置面板中的按键录入不再依赖单一输入框焦点，捕获模式会直接监听整页键盘事件。
- 修复 overlay 窗口仍被最小高度撑开的黑色矩形问题，允许悬浮窗按内容真实收缩。
- 修复全局快捷键第二次按下只写日志、不真正停止录音的问题，录音停止逻辑改为读取最新的 `recorder / mediaStream` 引用。
- 修复 overlay 模式下 `html` 仍保留背景的问题，透明窗口不再被页面背景污染。


## 0.0.7

- Windows `cmd` 启动时先切换到 UTF-8 代码页 `65001`，缓解终端中中文日志乱码问题。
- LLM 调试日志现在只打印最终 prompt 与返回 content，不再打印整包请求体。
- 发给窗口感知意图解析的窗口列表缩减为 `id / appName / title / state`。
- 优化意图解析 prompt：若应用窗口已存在，用户说“打开 A”时优先理解为聚焦现有 A 窗口，而不是重新启动实例。
- 避免控制台打印音频 `data:` base64 内容。
- 新增主进程 LLM 调试日志，终端会打印每次请求的 prompt 与收到的原始 content。
- 覆盖音频转写请求与窗口感知意图解析请求两类 LLM 调用。
- Electron 运行时改为使用项目内 `.runtime` 目录承载 `userData / sessionData / logs`。
- 修复默认缓存目录权限异常导致的 `Unable to create cache / Gpu Cache Creation failed` 问题。
- 修复 PowerShell 到 Node 的输出编码链路，统一改为 UTF-8 输出并使用 `-EncodedCommand` 传递脚本。
- 窗口标题、应用名等中文字段不再因控制台代码页不一致而出现乱码。
- 窗口快照为每个窗口新增简短编号 `W01 / W02 / ...`，并显示在右侧窗口列表中。
- 指令解析现在会把编号窗口列表一并发给 LLM，用于指定 `focus / close` 某个具体窗口。
- 新增结构化动作 `focus_window` / `close_window`，执行时携带窗口参数。
- 桥接执行器改为严格按原动作顺序逐条执行，保证“指定窗口聚焦 -> 输入文本”等组合动作顺序正确。

## 0.0.6

### Changed

- 日志中的“匹配到 N 个白名单动作”现在会同时列出具体动作明细，便于直接确认转写后的执行意图。

### Fixed

- 窗口 `focus` 动作改为优先走原生恢复流程：最小化时先 `SW_RESTORE`，再执行前台激活。
- 新增 `AttachThreadInput`、`BringWindowToTop`、`SetWindowPos` 辅助提升后台窗口调起成功率。
- 不再依赖前端按 `restoreBounds` 手动还原位置，优先使用 Windows 自身保存的恢复位置。
- 窗口列表现在会保留最小化窗口，不再因当前尺寸过小而被过滤掉。
- 窗口快照新增 `state` 与 `restoreBounds`，便于区分 `normal / minimized / maximized` 并显示恢复后位置。

## 0.0.5

### Fixed

- 加固窗口关闭逻辑：由单纯 `WM_CLOSE` 调整为“先聚焦，再尝试 `CloseMainWindow()`，最后回退窗口关闭消息”。
- 窗口动作请求现在会同时携带 `processId`，便于优雅关闭主窗口。

## 0.0.4

### Added

- 新增主进程窗口快照实例 `WindowRegistry`，支持手动刷新、窗口详情查询和窗口动作执行。
- 新增窗口管理 IPC：`listWindows`、`refreshWindows`、`getWindowDetail`、`windowAction`。
- 右侧侧栏新增系统窗口列表，点击后可弹窗查看应用名、句柄、位置尺寸等信息。
- 窗口详情弹窗新增 `调起 / 聚焦`、`关闭窗口`、`移动窗口` 操作。

### Changed

- 右侧容器现在同时承载手动动作、文本指令与窗口管理能力。

## 0.0.3

### Fixed

- 修复 Electron preload 使用 ESM 导致的加载失败问题，改为 `preload.cjs`。
- 修复 React renderer 在 `file://` 场景下资源路径错误的问题，Vite 构建改为相对 `./assets/...`。

## 0.0.2

### Changed

- 将 renderer 从原始 DOM 脚本切换为 React + Vite 结构。
- 新增轻量 shadcn 风格 UI 组件目录 `src-ui/components/ui`。
- 界面改为默认夜间模式，统一为黑白配色。
- 右侧新增独立操作侧栏，集中放置手动白名单动作和手动文本指令入口。
- Electron 启动流程改为先构建 React renderer，再加载 `renderer-dist/index.html`。

## 0.0.1

### Added

- 新建 Windows Electron 实验项目骨架。
- 新增主进程入口 [main.mjs](D:/Projects/AI/voiice/exp/bridge/main.mjs)，负责音频分析、动作匹配与执行调度。
- 新增预加载桥接层 [preload.mjs](D:/Projects/AI/voiice/exp/bridge/preload.mjs)，向渲染层暴露安全 IPC 接口。
- 新增桌面界面 [index.html](D:/Projects/AI/voiice/exp/bridge/index.html)、[renderer.mjs](D:/Projects/AI/voiice/exp/bridge/renderer.mjs)、[renderer.css](D:/Projects/AI/voiice/exp/bridge/renderer.css)。
- 新增 Qwen 音频转写模块 [src/transcribeQwen.mjs](D:/Projects/AI/voiice/exp/bridge/src/transcribeQwen.mjs)，支持流式与非流式模式。
- 新增本地白名单动作匹配模块 [src/commandMatcher.mjs](D:/Projects/AI/voiice/exp/bridge/src/commandMatcher.mjs)。
- 新增 Windows 控制模块 [src/windowsController.mjs](D:/Projects/AI/voiice/exp/bridge/src/windowsController.mjs)，支持白名单动作执行。
- 新增本地 smoke 脚本 [scripts/smoke-matcher.mjs](D:/Projects/AI/voiice/exp/bridge/scripts/smoke-matcher.mjs)。
- 新增项目说明 [README.md](D:/Projects/AI/voiice/exp/bridge/README.md) 与环境模板 [.env.example](D:/Projects/AI/voiice/exp/bridge/.env.example)。

### Supported Actions

- `focus_front_window`
- `close_front_window`
- `type_text_to_focused_input`
- `open_app("WeChat")`
- `send_shortcut("cmd+w")`

### Manual High Privilege Test Actions

- `move_mouse_to_center`
- `left_click_current_position`

### Notes

- 当前语音控制采用“模型转写 + 本地规则匹配 + 白名单执行”的安全边界。
- 当前录音模式为录音后提交，不是持续实时 agent。
- 后续若接入 Go / Rust 守护进程，可替换 `windowsController` 执行层而不影响前端与匹配逻辑。
