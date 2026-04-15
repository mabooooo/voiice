# PP-OCR Capability

这个目录用于把 `PP-OCRv5 mobile` 作为 `bridge` 的一个本地能力来部署，并在开发者模式里提供独立测试入口。

当前结论先写在最前面：

- 这条能力链已经接通，可以返回 OCR 文本行、位置线框和位置数据。
- 当前实现只做文本检测与识别，不做图标理解。
- **CPU 路线已修复并可用**：`paddle 3.0.0 + MKLDNN 开启`，720P 约 **4.7s**（原来因版本漂移 + MKLDNN 强制关闭导致 70s）。
- **GPU 路线实测可用**：RTX 4070，720P 约 100 行稳态 **≈0.5s**，约 200 行稳态 **≈1.1s**。

## 当前嵌入方式

当前接入结构如下：

1. `src-ui/features/desktop-utilities/PPOcrPanel.jsx`
   开发者模式中的 `PP-OCRv5 Mobile` 测试面板。
   点击按钮后，不走产品原有链路，只走独立测试链路。

2. `preload.cjs`
   暴露：
   - `probePPOcr`
   - `testPPOcr`

3. `main.mjs`
   主进程新增：
   - `bridge:probe-ppocr`
   - `bridge:test-ppocr`

   当前测试流程：
   - 先复用现有桌面截图能力抓取主屏
   - 再调用 `src/ppOcrClient.mjs`
   - 只消费结构化 OCR 行，不再保存标注图

4. `src/ppOcrClient.mjs`
   当前客户端方式：
   - 直接读取本地图像
   - 转成 `base64`
   - 请求本地 `FastAPI` 服务 `/parse/`

5. `capabilities/ppocr/service/server.py`
   当前服务方式：
   - 使用 `PaddleOCR`
   - 模型为：
     - `PP-OCRv5_mobile_det`
     - `PP-OCRv5_mobile_rec`
   - 当前参数：
     - `enable_mkldnn=True`（默认，可用 `PPOCR_DISABLE_MKLDNN=1` 关闭）
     - `cpu_threads=os.cpu_count()`（可用 `PPOCR_CPU_THREADS` 覆盖）
     - `device` 跟随 `PPOCR_DEVICE`，默认 `cpu`
     - `use_doc_orientation_classify=False`
     - `use_doc_unwarping=False`
     - `use_textline_orientation=False`

   服务输出（默认，不再包含标注图）：
   - `ocr_lines`
   - `line_count`
   - `latency`

   可选输出（请求时携带 `include_annotated: true`）：
   - `annotated_image_base64`

## 当前本地部署方式

在 `exp/bridge` 下执行：

```powershell
npm run capability:ppocr:setup
npm run capability:ppocr:start
```

当前部署约束：

- 项目内虚拟环境：`exp/bridge/capabilities/ppocr/.local/.venv`
- 本地缓存目录：`exp/bridge/capabilities/ppocr/.local/cache`
- 当前已显式把 `PADDLE_PDX_CACHE_HOME` 指向项目目录，避免模型继续落到用户目录

当前关键环境变量：

- `PADDLE_PDX_CACHE_HOME`
- `PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True`
- `PADDLE_PDX_MODEL_SOURCE=BOS`
- `PPOCR_DEVICE`（默认 `cpu`，改为 `gpu` 启用 GPU）
- `PPOCR_CPU_THREADS`（默认 `os.cpu_count()`）
- `PPOCR_DISABLE_MKLDNN`（默认 `0`，即 MKLDNN 开启）

### 启用 GPU（可选）

在已有 venv 里手动安装 GPU 版 paddle（会覆盖 CPU 版）：

```powershell
.\.local\.venv\Scripts\python.exe -m pip install paddlepaddle-gpu==3.0.0 `
  -i https://www.paddlepaddle.org.cn/packages/stable/cu126/
```

然后在 `.env` 或启动参数里设置：

```
PPOCR_DEVICE=gpu
```

## 当前测试方式

### 1. UI 测试

开发者模式中的 `PP-OCRv5 Mobile` 面板：

- `检测服务`
- `测试 PP-OCR`

测试按钮当前行为：

- 自动截取主屏截图
- 把截图发给本地 PP-OCR 服务
- 展示推理延迟与识别结果列表
- 不再回传或保存标注图

### 2. 代码直测

通过 `src/ppOcrClient.mjs` 直接请求本地服务，可以拆出截图链路与推理本身的耗时。

## 历史问题与根因（已修复）

### 根因：paddlepaddle 版本漂移导致 MKLDNN 崩溃

原 `setup.ps1` 写的是裸 `pip install paddlepaddle`，pip 解析到最新的 **`paddlepaddle 3.3.1`**。
`paddleocr 3.0.3 / paddlex 3.0.3` 对应的 ABI 是 `3.0.0`；`3.3.1` 引入了新的 PIR executor，
在 oneDNN 路径上有未实现的属性映射：

```
NotImplementedError: ConvertPirAttribute2RuntimeAttribute not support
  [pir::ArrayAttribute<pir::DoubleAttribute>]
  (at onednn_instruction.cc:118)
```

为了绕过崩溃把 `enable_mkldnn=False` 写死 → CPU 推理走朴素 kernel → 慢约 5 倍。

### 修复方式

- `requirements.windows.txt` 锁定 `paddlepaddle==3.0.0`
- `setup.ps1` 删掉裸 `pip install paddlepaddle`，统一走 requirements + 官方 CPU 源
- `server.py` 默认 `enable_mkldnn=True`，并将 `cpu_threads` 改为跟随 `os.cpu_count()`

### 修复后 CPU 多线程 benchmark（16 核）

重复 4 次推理，720P 合成图约 100 行文本：

| cpu_threads | 单次推理 |
|---|---|
| 4 | ~25,300 ms（修前 / MKLDNN 关） |
| 8（MKLDNN 开） | **~4,730 ms** |
| 16（MKLDNN 开） | **~4,700 ms** |

线程数 8 → 16 几乎没有变化，`rec` 模型在 CPU 上受限于算子实现，多核收益饱和。

### 其他优化：去掉标注图回传

原服务把整张 1280×720 PNG 标注图 base64 编码回传，约占 2–5s 额外开销。
现在默认不回传，前端只消费结构化 `ocr_lines`。需要调试时可在请求 body 里携带 `include_annotated: true`。

## 当前实测结果

### 测试机器

- CPU：16 核
- GPU：RTX 4070 12GB

### CPU 路线（修复后）

| 图像 | 行数 | 稳态耗时 |
|---|---|---|
| 720P 合成图（稀疏） | 100 | **~4,700 ms** |

### GPU 路线（RTX 4070，paddle-gpu 3.0.0 cu126）

首帧因 CUDA kernel JIT 约 2–4s，后续稳态：

| 图像 | 行数 | 稳态耗时 |
|---|---|---|
| 720P 合成图（稀疏） | 100 | **~520 ms** |
| 720P 合成图（密集） | 200 | **~1,130 ms** |

根据实测，720P 桌面真实图（~211 行）GPU 稳态约 **1.1–1.3s**，不能保证全场景稳定压到 1s 以内，但比修前 CPU 的 70s 提升约 **50 倍**。

## 当前阶段结论

当前 `PP-OCRv5 mobile` 的状态可以概括为：

- 功能接通：是
- UI 测试接通：是
- CPU 路线可用（≈5s / 720P）：是（已修复版本漂移 + MKLDNN 问题）
- GPU 路线可用（≈0.5–1.3s / 720P）：是（需手动安装 paddle-gpu）
- 速度满足"1s 以内"（CPU）：否
- 速度满足"1s 以内"（GPU，稀疏文本）：是

如果追求 CPU 路线 1s 以内，更现实的方向是：

- ONNX 路线（RapidOCR / onnxruntime）
- 只对缩小后的截图做 OCR
