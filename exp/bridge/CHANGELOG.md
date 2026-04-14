# Changelog

## 0.0.18

### Fixed

- 修复 overlay 窗口仍被最小高度撑开的黑色矩形问题，允许悬浮窗按内容真实收缩。
- 修复全局快捷键第二次按下只写日志、不真正停止录音的问题，录音停止逻辑改为读取最新的 `recorder / mediaStream` 引用。
- 修复 overlay 模式下 `html` 仍保留背景的问题，透明窗口不再被页面背景污染。

## 0.0.17

### Changed

- 重新设计底部状态窗的三种核心形态：录音中、处理中、执行结果分别采用独立布局，不再共用同一套胶囊结构。
- 所有状态图标、字号和胶囊尺寸整体收小，减少当前悬浮窗的视觉压迫感。

### Added

- 录音态新增实时音量柱形反馈，柱形高度会随麦克风输入变化。
- 执行态新增更接近通知卡片的结果面板，用于展示最终执行的命令说明。

## 0.0.16

### Added

- 新增原生全局键盘钩子 `uiohook-napi`，替代单独依赖 Electron `globalShortcut` 的修饰键触发方式。
- 右侧新增“设置 / 全局录音键”面板，支持按键识别、保存生效和查看最近识别/触发状态。

### Changed

- 底部悬浮窗重做为更接近灵动岛的黑色胶囊形态，空闲/录音/等待/执行四种状态的视觉反馈重新设计。
- 窗口列表重新显示 `W01 / W02` 这类短编号，便于和 LLM 侧窗口参数保持一致。

### Fixed

- 修复 Windows 下“右 Alt 没有反应”的问题，录音切换改走原生全局键盘事件。
- 设置面板中的按键录入不再依赖单一输入框焦点，捕获模式会直接监听整页键盘事件。

## 0.0.15

### Added

- 新增桌面底部悬浮录音状态窗，支持 `idle / listening / waiting / executing` 四种状态。
- 新增全局 `Alt / AltGr` 录音切换尝试，按下开始录音，再按一次停止。

### Changed

- 录音分析完成后默认直接执行，不再依赖前端批准开关。
- 等待服务器返回、执行动作完成等状态会同步展示到悬浮状态窗，并在执行完成 4 秒后自动回到静息态。

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
