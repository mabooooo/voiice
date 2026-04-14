# Changelog

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
