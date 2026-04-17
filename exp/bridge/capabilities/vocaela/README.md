# Vocaela-2-500M-1024R2 Capability

这个目录把 [`vocaela/Vocaela-2-500M-1024R2`](https://huggingface.co/vocaela/Vocaela-2-500M-1024R2) 作为 `bridge` 的一个本地能力来部署：

- 模型定位：500M 参数的小型 VLM，专门做"截图 + 指令 -> 结构化 GUI 动作"的低层级控制
- 输入：一张桌面 / 窗口截图（建议最长边 < 2048）+ 一句自然语言指令，例如"click the submit button"
- 输出：`<Action>...</Action>` 里的 JSON 动作数组，坐标以 `[0,1)` 归一化给出
- 基座：`SmolVLM2-500M-Video-Instruct` 文本塔 + `siglip-base-patch16-256` 视觉塔
- 许可：`CC BY-NC-SA 4.0`（仅限非商业用途）

## 接入结构

```
capabilities/vocaela/
├── README.md                  # 本文档
├── requirements.windows.txt   # 运行时依赖（不含 torch，torch 由 setup.ps1 单独装）
├── setup.ps1                  # 一键部署：建 venv、装 torch/transformers、下权重
├── start.ps1                  # 启动本地 FastAPI 服务
└── service/
    └── server.py              # FastAPI 服务（/probe/ + /parse/）
```

部署产物目录（仓库已通过 `*.local` 忽略）：

```
capabilities/vocaela/.local/
├── .venv/                     # 项目内虚拟环境
├── cache/                     # pip / hf / tmp 缓存
└── models/
    └── Vocaela-2-500M-1024R2/ # 下载下来的权重
```

## 本地部署

在 `exp/bridge` 下执行：

```powershell
# 默认走 GPU（cu124 wheel），显卡缺失时可用 -Device cpu 改走 CPU
powershell -ExecutionPolicy Bypass -File .\capabilities\vocaela\setup.ps1
```

首次部署会做以下动作：

1. 在 `.local/.venv` 建项目内虚拟环境
2. 装 `torch==2.6.0 (cu124)`（或 `cpu`）、`transformers>=4.51` 等运行时依赖
3. 用 `hf` CLI 把 `vocaela/Vocaela-2-500M-1024R2` 下载到 `.local/models/Vocaela-2-500M-1024R2`

## 启动服务

```powershell
powershell -ExecutionPolicy Bypass -File .\capabilities\vocaela\start.ps1
```

默认：

- Host: `127.0.0.1`
- Port: `8030`
- Device: `gpu`（与 `ppocr` / `sensevoice` 保持一致的入口名；内部归一化为 `cuda`）

可选参数：

- `-BindHost`：绑定地址
- `-Port`：监听端口（默认 `8030`，与其他 capability 不冲突）
- `-Device`：`gpu` / `cuda` / `cpu`

## 接口

### `GET /probe/`

探活用，返回当前模型路径、设备、attention 实现等。

### `POST /parse/`

请求体：

```json
{
  "base64_image": "<PNG/JPG base64>",
  "instruction": "Click the submit button",
  "system_prompt": null,
  "max_new_tokens": 96,
  "do_sample": false,
  "temperature": 1.0
}
```

返回：

```json
{
  "ok": true,
  "mode": "vocaela-2-500m-1024r2",
  "latency": 0.82,
  "image_size": [1032, 774],
  "raw_text": "[{\"action\":\"click\",\"coordinate\":[0.12,0.34]}]",
  "action_text": "[{\"action\":\"click\",\"coordinate\":[0.12,0.34]}]",
  "actions": [
    {
      "action": "click",
      "coordinate": [0.12, 0.34],
      "coordinate_pixel": [124, 263]
    }
  ]
}
```

说明：

- `system_prompt` 默认使用 model card 推荐的 Computer-Use 提示，训练期也用这条，稳定性最高
- `coordinate_pixel` 是把 `[0,1)` 归一化坐标按请求里的图像分辨率反算回来的像素坐标，前端 `click_at({x,y})` 可以直接消费
- `action_text` 是 `<Action>...</Action>` 里原始的 JSON 文本；如果模型返回异常，`actions` 会退化成空数组，但 `raw_text` 会保留供排查

## 快速测试

### 方法 A：直接用 venv python 跑一次 inference（不起服务）

```powershell
$venv = ".\capabilities\vocaela\.local\.venv\Scripts\python.exe"
$image = ".\.runtime\desktop-captures\<your-screenshot>.jpg"
& $venv -c @"
import base64, json
from pathlib import Path
from capabilities.vocaela.service.server import run_inference, extract_action_text, parse_actions, denormalize_actions
from PIL import Image

img = Image.open(r'$image').convert('RGB')
raw = run_inference(img, 'Click the submit button', None, 96, False, 1.0)
text = extract_action_text(raw)
print({'raw_text': raw, 'actions': denormalize_actions(parse_actions(text), img.size)})
"@
```

### 方法 B：启动服务 + HTTP 调用

```powershell
# 终端 1：起服务
npm run capability:vocaela:start  # 或直接调用 start.ps1

# 终端 2：用 PowerShell 推一张本地截图
$img = [Convert]::ToBase64String([IO.File]::ReadAllBytes("D:\path\to\screenshot.jpg"))
$body = @{
  base64_image = $img
  instruction = "Click the submit button"
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8030/parse/" -Body $body -ContentType "application/json"
```

## 局限

这里的局限直接引用 model card：

- 只做低层级 GUI 动作（click / type / scroll / hotkey 等），不具备高层级 agent 推理能力
- 不适合高分辨率细节识别，推荐最长边 < 2048
- 不支持视频输入
- 通用 VLM 能力相比基座有所下降


## 测试结果
#	指令	延迟	归一化坐标	像素坐标
1	Click the '新线程' button	3.98s（含首帧）	[0.050, 0.135]	[103, 207]
2	Click the settings icon at the bottom left	1.61s	[0.026, 0.973]	[54, 1493]
3	Click the send (arrow up) button at the bottom right	1.67s	[0.920, 0.929]	[1900, 1425]
4	Click the message input field	1.56s	[0.621, 0.875]	[1282, 1342]
5	Click the 'rebuild' branch indicator	1.53s	[0.924, 0.760]	[1908, 1166]
首次推理 4s（权重加载 + CUDA kernel JIT），后续稳态 1.5–1.7s/次。前 4 条坐标与截图里的目标控件位置对得上；第 5 条的 'rebuild' 落到了右侧模型面板，截图里有多处 rebuild 文本，这属于模型上下文歧义而非链路问题。

### 显存占用
显存占用测试结果
环境：RTX 4070 12GB / fp16 / sdpa / Windows 11 / torch 2.6.0+cu124
测试图：window-w05-20260416-201030.jpg (2065×1534)

阶段	整卡 nvidia-smi	torch alloc	torch reserved	备注
基线（无本进程）	3731 MiB	—	—	其他 GPU 占用（桌面/浏览器等）
import torch + CUDA ctx	3905 MiB (+174)	0 MiB	2 MiB	CUDA runtime + kernel 镜像
模型加载完成	4910 MiB (+1179)	970 MiB	1008 MiB	fp16 500M 权重
冷启推理峰值	5414 MiB (+1683)	1416 MiB	1494 MiB	含首帧 JIT
温推理峰值 (×3)	5414 MiB (+1683)	1417 MiB	1494 MiB	稳态 1.6–1.7s/次
核心数据：

模型权重：~970 MiB（fp16，约等于 500M 参数 × 2B）
推理峰值增量：~450 MiB 额外显存用于 KV cache + activations
torch 内部总占用：~1.4 GiB
整进程 GPU 占用（含 CUDA ctx）：~1.7 GiB
结论：

2065×1534 输入下单条推理稳态 < 1.5 GiB VRAM，离 4070 的 12 GiB 上限非常远
冷热峰值一致（1416 vs 1417 MiB），没有显存泄漏
如果改走 bfloat16（显卡支持）或 int8/Q8_0 GGUF（官方给了量化版），还能再砍一半