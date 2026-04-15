2. 底部常驻调试状态栏（main window 内部）

在 App.jsx 最外层 app-shell 内追加 <DebugStatusBar />，fixed 在主窗口底部（不是那个悬浮 overlay——那是另一个 BrowserWindow，贴桌面用的）。
订阅一个新的 IPC 推送通道 bridge:debug-status-push，展示：SenseVoice 状态 · PP-OCR 状态 · 当前语音链路阶段（idle / listening / ocr / await_selection / clicking）· 最近一次耗时 / 错误。
主进程维护 debugBus：OCR 预热、ASR 每次转写、语音 FSM 切换，都往这里写。