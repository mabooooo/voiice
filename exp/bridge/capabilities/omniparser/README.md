# OmniParser Capability

这个目录用于把 OmniParser 作为 `bridge` 的一个本地能力来部署。

当前实现改为“检测版”：

- 只使用新仓库里的 `icon_detect`
- 不使用 `icon_caption_blip2`
- 不使用 `icon_caption_florence`
- Python 依赖、模型和缓存都尽量落在当前项目的 `.local/` 下

## 目录说明

- `setup.ps1`：初始化本地部署，包括创建项目内虚拟环境、安装依赖、下载新仓库 `icon_detect` 权重。
- `start.ps1`：启动本地 FastAPI 服务。
- `service/server.py`：`bridge` 使用的本地适配服务，负责把截图转成 `icon detect + OCR` 结果。
- `.local/`：本地部署产物目录，默认不会提交到 Git。

## 使用方式

在 `exp/bridge` 下执行：

```powershell
npm run capability:omniparser:setup
npm run capability:omniparser:start
```

默认行为：

- 项目内虚拟环境：`exp/bridge/capabilities/omniparser/.local/.venv`
- 服务地址：`http://127.0.0.1:8000`
- 模型权重目录：`exp/bridge/capabilities/omniparser/.local/weights/icon_detect/model.pt`
- 本地缓存目录：`exp/bridge/capabilities/omniparser/.local/cache`

## 说明

- 这里默认走 `EasyOCR`，不安装 `PaddleOCR`。
- 首次部署只会下载新仓库的 `icon_detect` 权重，体积比完整 caption 方案更小。
- `bridge` 开发者模式中的“测试 OmniParser”按钮会自动截取主屏并调用这个本地服务。
