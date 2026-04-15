# SenseVoice Capability

这个目录用于把 `SenseVoice Small` 作为 `bridge` 的一个本地语音识别能力来部署。

当前实现：

- 使用 `FunASR + SenseVoiceSmall`
- 只负责本地语音转文本，不参与动作规划
- 依赖、模型和缓存默认都落在当前项目的 `.local/` 下

## 目录说明

- `setup.ps1`：初始化本地部署，包括创建项目内虚拟环境、安装依赖、下载 `SenseVoiceSmall` 模型。
- `start.ps1`：启动本地 FastAPI 服务。
- `service/server.py`：`bridge` 使用的本地适配服务，负责把音频转成文本。
- `.local/`：本地部署产物目录，默认不会提交到 Git。

## 使用方式

在 `exp/bridge` 下执行：

```powershell
npm run capability:sensevoice:setup
npm run capability:sensevoice:start
```

默认行为：

- 项目内虚拟环境：`exp/bridge/capabilities/sensevoice/.local/.venv`
- 服务地址：`http://127.0.0.1:8010`
- 模型目录：`exp/bridge/capabilities/sensevoice/.local/models/SenseVoiceSmall`
- 本地缓存目录：`exp/bridge/capabilities/sensevoice/.local/cache`

## 说明

- 设置页开启“SenseVoice 本地识别”后，每次音频分析都会并行触发一次本地转写。
- 本地识别结果仅用于对照展示，不会替代原有云端动作解析链路。
- 服务默认按 `cpu` 推理启动；如果后续需要，也可以在启动脚本里手动切到 `cuda`。
