# Changelog
## 0.0.13 Xiaomi thinking 配置补齐

### Changed

- Xiaomi MiMo 请求现在会在 `extra_body` 中额外补齐 `thinking.type = disable`，避免仅传 `enable_thinking: false` 时的兼容问题。
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
