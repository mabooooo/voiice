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
- 支持基于 `SenseVoice + OCR` 的本地点选式语音路由：可在 `PP-OCR` 与 `RapidOCR` 之间切换，并可选开启“空间记忆”来加速同窗口重复点击

## TODO

- Overlay 迁移到 sidecar overlay：
  当前窗口高亮、候选框和连续听写指示层仍由 Electron 顶层透明窗承载，能工作，但仍绑定 Chromium 渲染与 BrowserWindow 生命周期。
- 这项技术债起于 `v0.0.23`：
  当时优先验证连续听写、窗口 OCR 和跨屏坐标换算，先复用了现成 Electron 主进程 + renderer 能力，改动最小、联调最快。
- 当前原因：
  现方案跨端一致性一般，Windows/macOS 都要分别处理透明窗层级、点击穿透、残影和工作区行为；高频刷新也不如原生 overlay 稳。
- 计划：
  保留现有整屏/窗口截图、OCR、点击与坐标换算逻辑，把“只负责显示指示器”的 overlay 下沉到 sidecar；Electron 继续保留设置页、调试页和业务编排。
- macOS 考虑：
  目标方案不依赖改第三方窗口边框，而是走原生透明点击穿透 overlay；需要单独处理 Spaces、全屏、Mission Control / Stage Manager 的窗口层级与显示行为。

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
SENSEVOICE_DEVICE=cpu || cuda
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
- `capabilities/vocaela`：本地 Vocaela-2-500M-1024R2 视觉语言 GUI agent 部署脚本、适配服务与说明文档

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

## 本地部署 Vocaela-2-500M-1024R2

首次部署：

```powershell
npm run capability:vocaela:setup
```

启动本地服务：

```powershell
npm run capability:vocaela:start
```

说明：

- 默认使用项目内虚拟环境 `exp/bridge/capabilities/vocaela/.local/.venv`
- 默认服务地址为 `http://127.0.0.1:8030`
- 默认模型目录为 `exp/bridge/capabilities/vocaela/.local/models/Vocaela-2-500M-1024R2`
- 默认缓存目录为 `exp/bridge/capabilities/vocaela/.local/cache`
- 与 `ppocr` / `omniparser` 只做 OCR / 图标检测不同，这里做的是"截图 + 指令 -> 结构化 GUI 动作"（带归一化坐标），服务会把 `[0,1)` 坐标同步回算成像素坐标方便 `click_at({x,y})` 消费
- 许可为 `CC BY-NC-SA 4.0`，仅限非商业用途

## 语音点选路由

当前项目新增了一条本地“语音触发 -> OCR 候选 -> 说序号点击”的实验链路：

1. 右 `Alt` 开始录音
2. 说“点击开发者模式”这类触发语句
3. 松开后，主屏会执行一次原始 PNG 截图，并按设置页选择调用 `PP-OCR` 或 `RapidOCR`
4. 命中的候选项会以带编号的青色框显示在对应屏幕上
5. 如果只命中 `1` 项，会直接点击；只有命中多项时才需要再说“3”或“第三个”
6. 路由器会把编号映射为 `click_at({x,y})` 执行点击

当前 FSM：

- `idle`
- `await_selection`

约束：

- `15s` 内没有说出编号会自动 reset 并清空候选框
- 触发词支持：`点击 / 点一下 / 打开 / open / click + 关键词`
- 序号支持：`1-9 / 一二三四五六七八九 / 第X个`
- 候选筛选来自 OCR 行，按完整命中和短文本命中加权，最多保留 `9` 个
- 候选框会围绕原 OCR 框居中外扩 `20px` padding，编号默认显示在右侧，若超出屏幕右边缘则切到左侧
- 设置页提供“语音点选 OCR 后端”开关：关闭时走原有 `PP-OCR`，打开时走 `.runtime/rapidocr_test.py` 验证过的 `RapidOCR detect + recognize` 链路
- 设置页提供“空间记忆”开关，默认开启；命中记忆时会优先走“当前窗口小区域 OCR”，失败后自动回退到整屏 OCR

## 空间记忆模块

当前项目内置了一个轻量的“应用 -> 窗口 -> 空间记忆”模块，用于提升重复点击同一窗口控件时的速度与稳定性。

存储结构：

- 应用层：记录 `appName / processPath / naming / habits`
- 窗口层：按“应用 + 归一化窗口标题”划分窗口 profile
- 记忆层：按关键词保存 `labelText / relativeRect / lastBackend / lastMode / hitCount / updatedAt`

当前实现文件：

- [src/appSpatialMemoryStore.mjs](D:/Projects/AI/voiice/exp/bridge/src/appSpatialMemoryStore.mjs)

本地落盘位置：

- `exp/bridge/.runtime/app-spatial-memory.json`

工作流程：

1. 第一次说“点击设置”时，仍然走整屏 OCR 或普通多候选确认链路
2. 点击成功后，会识别当前前台窗口，并重新截图该窗口
3. 再在窗口截图内部用同一关键词做一次 OCR，得到按钮相对窗口的位置与大小
4. 以后再次说同一关键词时，若当前前台窗口存在这条记忆，则先截该窗口的小区域做 OCR
5. 小区域命中后，直接按“窗口句柄 + 窗口内局部坐标”点击；如果小区域没命中，则自动回退整屏 OCR

当前约束：

- 记忆匹配以“应用 + 窗口标题 + 关键词”为主，不做跨窗口泛化
- 适合布局稳定、标题稳定的页面
- 当窗口标题、布局或控件位置明显变化时，会自动回退，不强行使用旧记忆
- 当前命中后不会再次刷新同一条记忆，避免重复抖动

调试方式：

- 有麦链路：按右 `Alt` 录“点击开发者模式” -> 若单候选则直接点击；若多候选则候选框出现 -> 再说“第三个”
- 无麦链路：在渲染进程 console 执行 `bridgeApi.voiceRouteText({ transcript: '点击开发者模式', ocrBackend: 'rapidocr', spatialMemoryEnabled: true })`
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
- Execution Log 当前主要用于查看关键语音链路状态；终端会保留 `capture completed` 与当前 OCR 后端的完成日志，例如 `ppocr completed / rapidocr completed`，便于排查 OCR 慢点
- 空间记忆命中时，终端会继续输出 `spatial-memory hit / miss / save source / saved` 等日志，便于排查小区域 OCR 是否命中、记忆是否写入，以及最终是否回退到整屏 OCR
- 桌面截图默认保存到 `exp/bridge/.runtime/desktop-captures`
- 空间记忆文件默认保存到 `exp/bridge/.runtime/app-spatial-memory.json`
- OmniParser 本地部署产物默认保存到 `exp/bridge/capabilities/omniparser/.local`
- PP-OCR 本地部署产物默认保存到 `exp/bridge/capabilities/ppocr/.local`
- SenseVoice 本地部署产物默认保存到 `exp/bridge/capabilities/sensevoice/.local`
- 当前界面为 React + Vite 构建产物，Electron 启动前会先构建 renderer
- 后续可以把 `src/windowsController.mjs` 替换为 Go / Rust 守护进程 RPC
