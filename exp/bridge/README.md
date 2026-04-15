# Bridge / Windows Electron

这是一个独立的 Windows Electron 实验项目，目标是把语音输入转成安全的桌面白名单动作。

## 当前能力

- 使用 React renderer，并采用轻量的 shadcn 风格组件组织界面
- 选择本地音频文件进行测试
- 使用麦克风录音并导入测试
- 调用阿里云百炼北京节点 `qwen3-omni-flash` 做音频转写
- 可选启用本地 `SenseVoice Small` 并行做语音识别
- 在本地把转写文本匹配成白名单动作
- 执行 Windows 桌面动作
- 在开发者模式里执行多屏桌面截图，并可额外生成 `640P` 压缩截图落盘
- 开发者模式窗口列表支持对指定窗口做本地边框高亮，默认 `3s` 后自动消失
- 开发者模式窗口详情页支持单独截图当前窗口，并保存到本地截图目录
- 支持基于 `SenseVoice + PP-OCR` 的本地点选式语音路由：先说“点击 xxx”，再说“第 N 个”

## 安全边界

当前实现采用三段式：

1. 模型只负责把音频转成文本
2. 本地规则把文本匹配成白名单动作
3. Windows 执行层只接受白名单动作

这样后续你切到 Go / Rust 原生 agent 守护进程时，只需要替换执行层。

## 白名单动作

- `focus_front_window`
- `close_front_window`
- `type_text_to_focused_input`
- `open_app("WeChat")`
- `send_shortcut("cmd+w")`
- `click_at({x, y})`

## 高权限测试动作

以下动作只在界面里手动触发，不走语音匹配：

- `move_mouse_to_center`
- `left_click_current_position`

## 安装

```bash
cd exp/bridge
copy .env.example .env
npm install
```

在 `.env` 中填写：

```bash
DASHSCOPE_API_KEY=你的百炼Key
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen3-omni-flash

XIAOMI_MIMO_API_KEY=你的 Xiaomi Key
XIAOMI_MIMO_BASE_URL=https://api.xiaomimimo.com/v1
XIAOMI_MIMO_MODEL=mimo-v2-omni

OMNIPARSER_BASE_URL=http://127.0.0.1:8000
PPOCR_BASE_URL=http://127.0.0.1:8020
SENSEVOICE_BASE_URL=http://127.0.0.1:8010
SENSEVOICE_AUTOSTART=true
SENSEVOICE_DEVICE=cpu
```

如果切到 `Xiaomi MiMo` provider，请求 body 里需要额外带上：

```json
{
  "thinking": {
    "type": "disable"
  }
}
```

当前项目会把这组字段直接写到最终请求 body 根层，并继续统一传递 `enable_thinking: false`。

## 本地能力目录

现在 `bridge` 下新增了 `capabilities/` 目录，用于部署各种本地能力。

当前已接入：

- `capabilities/omniparser`：本地 OmniParser 部署脚本、适配服务与说明文档
- `capabilities/ppocr`：本地 PP-OCRv5 mobile 部署脚本、适配服务与说明文档
- `capabilities/sensevoice`：本地 SenseVoice Small 部署脚本、适配服务与说明文档

能力目录约束：

- 可提交到仓库的部分只保留脚本、说明和适配层
- 权重、虚拟环境、克隆仓库等本地部署产物统一落到各能力目录自己的 `.local/` 下

## 本地部署 OmniParser

首次部署：

```powershell
npm run capability:omniparser:setup
```

启动本地服务：

```powershell
npm run capability:omniparser:start
```

说明：

- 默认使用项目内虚拟环境 `exp/bridge/capabilities/omniparser/.local/.venv`
- 默认服务地址为 `http://127.0.0.1:8000`
- 默认缓存目录为 `exp/bridge/capabilities/omniparser/.local/cache`
- 开发者模式新增了 `OmniParser` 测试面板，可自动截取主屏并调用本地服务
- 当前只使用新仓库里的 `icon_detect`
- 当前不使用 `icon_caption_blip2 / icon_caption_florence`
- 这里默认使用 `EasyOCR`，不安装 `PaddleOCR`

## 本地部署 PP-OCRv5 Mobile

首次部署：

```powershell
npm run capability:ppocr:setup
```

启动本地服务：

```powershell
npm run capability:ppocr:start
```

说明：

- 默认使用项目内虚拟环境 `exp/bridge/capabilities/ppocr/.local/.venv`
- 默认服务地址为 `http://127.0.0.1:8020`
- 默认缓存目录为 `exp/bridge/capabilities/ppocr/.local/cache`
- 当前只使用 `PP-OCRv5 mobile det + rec`
- 开发者模式新增了 `PP-OCRv5 Mobile` 测试面板，可自动截取主屏并保存 OCR 标注图
- Electron 启动时会自动托管本地 PP-OCR 服务，并在首次启动后跑一次 `1x1 PNG` warmup，尽量把模型加载前移

## 语音点选路由

当前项目新增了一条本地“语音触发 -> OCR 候选 -> 说序号点击”的实验链路：

1. 右 `Alt` 开始录音
2. 说“点击开发者模式”这类触发语句
3. 松开后，主屏会执行一次原始 PNG 截图与 PP-OCR
4. 命中的候选项会以带编号的青色框显示在对应屏幕上
5. 再按右 `Alt` 说“3”或“第三个”
6. 路由器会把编号映射为 `click_at({x,y})` 执行点击

当前 FSM：

- `idle`
- `await_selection`

约束：

- `15s` 内没有说出编号会自动 reset 并清空候选框
- 触发词支持：`点击 / 点一下 / 打开 / open / click + 关键词`
- 序号支持：`1-9 / 一二三四五六七八九 / 第X个`
- 候选筛选来自 OCR 行，按完整命中和短文本命中加权，最多保留 `9` 个

调试方式：

- 有麦链路：按右 `Alt` 录“点击开发者模式” -> 候选框出现 -> 再说“第三个”
- 无麦链路：在渲染进程 console 执行 `bridgeApi.voiceRouteText({ transcript: '点击开发者模式' })`
- 状态重置：可调用 `bridgeApi.voiceReset()`

## 本地部署 SenseVoice Small

首次部署：

```powershell
npm run capability:sensevoice:setup
```

启动本地服务：

```powershell
npm run capability:sensevoice:start
```

说明：

- 默认使用项目内虚拟环境 `exp/bridge/capabilities/sensevoice/.local/.venv`
- 默认服务地址为 `http://127.0.0.1:8010`
- 默认模型目录为 `exp/bridge/capabilities/sensevoice/.local/models/SenseVoiceSmall`
- 默认缓存目录为 `exp/bridge/capabilities/sensevoice/.local/cache`
- Electron 启动时会默认自动拉起本机 `SenseVoice` 服务；如需关闭可设置 `SENSEVOICE_AUTOSTART=false`
- 自动启动的服务日志保存在 `exp/bridge/.runtime/logs/sensevoice.managed.*.log`
- 开发者模式提供独立的本地 ASR 测试面板，可切换 `流式 / 非流式`，并可开关 `VAD`
- 设置页可独立开启 `SenseVoice` 本地识别；开启后每次音频分析都会并行触发一次本地转写
- 本地识别结果只用于对照展示，不替代原有云端动作解析链路

## 启动

```bash
npm run start
```

## 说明

- 流式模式用于观察首字延迟
- 非流式模式更适合短语音指令场景
- `cmd+w` 在 Windows 里会映射为 `Ctrl+W`
- 当前桌面控制通过 Electron 主进程调用 PowerShell 完成
- 窗口高亮使用长期驻留的透明、置顶、鼠标穿透 Electron 窗口，默认隐藏，仅在测试时短暂显示
- 窗口截图会先把目标窗口调到前台，再优先使用 `PrintWindow` 抓取内容；若失败，会对前台窗口回退为按屏幕区域裁剪
- 右 `Alt` 快捷键停止录音后的链路目前优先走本地 `SenseVoice + FSM`，云端 LLM 动作解析在该快捷键链路里暂时屏蔽
- 手动文件分析和界面按钮触发的分析链路仍保持原有云端解析方式
- 候选框 Overlay 使用逻辑像素；截图与点击落点使用物理像素，并通过 `display.nativeOrigin` 适配多显示器拼接
- Execution Log 会订阅本地语音路由日志，便于观察候选筛选、状态切换和点击执行过程
- 桌面截图默认保存到 `exp/bridge/.runtime/desktop-captures`
- OmniParser 本地部署产物默认保存到 `exp/bridge/capabilities/omniparser/.local`
- PP-OCR 本地部署产物默认保存到 `exp/bridge/capabilities/ppocr/.local`
- SenseVoice 本地部署产物默认保存到 `exp/bridge/capabilities/sensevoice/.local`
- 当前界面为 React + Vite 构建产物，Electron 启动前会先构建 renderer
- 后续可以把 `src/windowsController.mjs` 替换为 Go / Rust 守护进程 RPC
