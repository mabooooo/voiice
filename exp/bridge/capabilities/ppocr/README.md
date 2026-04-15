# PP-OCR Capability

这个目录用于把 `PP-OCRv5 mobile` 作为 `bridge` 的一个本地能力来部署，并在开发者模式里提供独立测试入口。

当前结论先写在最前面：

- 这条能力链已经接通，可以返回 OCR 文本行、位置线框和标注图。
- 当前实现只做文本检测与识别，不做图标理解。
- 当前速度明显不符合“替代 OmniParser 的更快方案”预期。
- 目前在这台机器上，`720P` 文本密集桌面截图的实际耗时仍在 `40s+`，还不能作为最终方案。

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
   - 把服务返回的标注图保存到截图目录
   - 文件名后缀为 `-ppocr.png`

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
   - 当前固定参数：
     - `device='cpu'`
     - `enable_mkldnn=False`
     - `cpu_threads=4`
     - `use_doc_orientation_classify=False`
     - `use_doc_unwarping=False`
     - `use_textline_orientation=False`

   服务输出：
   - `ocr_lines`
   - `line_count`
   - `annotated_image_base64`
   - `latency`

6. 标注图绘制方式
   当前不是像 OmniParser 那样输出语义块，而是：
   - 按 OCR 返回的多边形画线框
   - 在框边标注 `id + 截断文本`
   - 便于人工核对定位是否正确

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

## 当前测试方式

### 1. UI 测试

开发者模式中的 `PP-OCRv5 Mobile` 面板：

- `检测服务`
- `测试 PP-OCR`

测试按钮当前行为：

- 自动截取主屏截图
- 把截图发给本地 PP-OCR 服务
- 展示标注图
- 展示 OCR 结果列表
- 把标注图保存到截图目录

### 2. 代码直测

为了排查速度问题，额外做了两类测试：

1. 通过 `src/ppOcrClient.mjs` 直接请求本地服务
2. 直接在 `ppocr` 项目内虚拟环境里运行 `PaddleOCR.predict()`，绕开 Electron/UI

这样可以拆出：

- 是不是主进程截图链路的问题
- 是不是 HTTP / JSON / base64 返回过重的问题
- 还是 `PaddleOCR` 推理本身就慢

## 当前实测结果

### 测试图 1

文件：

`exp/bridge/.runtime/desktop-captures/desktop-720p-d2-20260415-110845.jpg`

这是当前最重要的一张基准图，因为你明确要求先验证 `720P` 是否异常。

### 结果 1：服务连续两次测试

同一张 `720P` 图，连续两次请求服务，结果分别约为：

- 第一次：`69635 ms`
- 第二次：`70339 ms`

结论：

- 不是冷启动问题
- 不是首次下载问题
- 同图重复推理仍然稳定在 `70s` 左右

### 结果 2：删除大体积 `raw_result` 返回后

之前服务把一大坨 `raw_result` 直接回给前端，当前 UI 实际并没有使用它。

删掉之后，同一张 `720P` 图再测：

- `localLatencyMs`: `44718 ms`
- `serviceLatencySeconds`: `44.41 s`
- `lineCount`: `211`

结论：

- 之前有额外的传输 / JSON 解析开销
- 去掉 `raw_result` 后，总耗时从约 `70s` 降到约 `45s`
- 但推理本身依然非常慢

### 结果 3：绕开服务，直接调用 PaddleOCR

直接在 Python 里对同一张 `720P` 图做 `predict()`，当前基线大约为：

- `39748 ms`

结论：

- 慢点主要在 `PaddleOCR` CPU 推理本身
- 服务序列化、base64 标注图返回，还会再叠加几秒到十几秒

### 结果 4：尝试调参

已经试过这些参数方向：

- `text_recognition_batch_size=16`
- `text_recognition_batch_size=32`
- `text_recognition_batch_size=64`
- `cpu_threads=8`

结果没有明显变快，部分更慢。

### 测试图 2

文件：

`exp/bridge/.runtime/desktop-captures/desktop-full-d1-20260414-222111.png`

结果：

- 默认 `120s` 客户端超时不够
- 放宽超时后仍然明显过慢
- 用户中途打断

结论：

- 当前这套方案在完整高分辨率桌面截图上更不适合

## 当前已确认的问题

### 1. 速度异常慢

这是当前最核心的问题。

在这台机器上：

- `720P` 文本密集桌面截图约 `40s+`
- 对“正常 OCR”来说，这个速度明显不合理

### 2. 不是简单的初始化问题

已确认不是这些原因：

- 不是首次模型下载
- 不是每次重新建模
- 不是首次请求冷启动

### 3. 当前 CPU 路径必须关闭 MKLDNN

如果不显式关闭：

- 会触发 `oneDNN / MKLDNN` 路径上的运行时错误

当前服务里已经固定：

- `enable_mkldnn=False`

### 4. Paddle 生态版本兼容问题

当前排查过程中已经确认过：

- `paddleocr 3.0.3 + paddlex 3.4.3` 不兼容
- 需要回到 `paddlex 3.0.3`

当前 requirements 已固定：

- `paddleocr==3.0.3`
- `paddlex==3.0.3`
- `numpy<2`
- `Pillow==11.3.0`
- `packaging<26`

### 5. 当前能力还不适合作为 OmniParser 的替代方案

虽然功能上已经通了：

- 能识别文本
- 能画定位线框
- 能保存标注图

但速度上还没有达到目标。

## 当前测试输出长什么样

当前服务会返回：

```json
{
  "ok": true,
  "latency": 44.4,
  "mode": "ppocrv5-mobile",
  "line_count": 211,
  "ocr_lines": [
    {
      "id": 0,
      "text": "File Edit Selection View Go Run Terminal Help",
      "score": 0.96,
      "polygon": [[35, 6], [369, 7], [369, 25], [35, 24]],
      "bbox": [35, 6, 369, 25]
    }
  ],
  "annotated_image_base64": "..."
}
```

其中：

- `ocr_lines` 是当前前端真正使用的结果
- `annotated_image_base64` 会被主进程保存为 `-ppocr.png`

## 当前阶段结论

当前 `PP-OCRv5 mobile` 的状态可以概括为：

- 功能接通：是
- UI 测试接通：是
- 标注图保存：是
- 缓存尽量落项目目录：是
- 速度满足“快速替代 OmniParser”：否

当前更准确的定位应该是：

- 它是一个“已接通但性能不达标的 OCR 试验接入”
- 还不是最终可用的桌面视觉快速方案

## 后续建议

如果继续沿这个方向优化，优先级建议如下：

1. 先确认是否要继续保留 `PaddleOCR v3` 这条路线
2. 如果保留，优先继续排查 CPU 推理异常慢的根因
3. 如果目标是“明显快于 OmniParser”，更现实的方向可能是：
   - 更轻量的 OCR runtime
   - ONNX 路线
   - RapidOCR 一类方案
   - 或只对缩小后的截图做 OCR

当前这份 README 记录的是“现在真实落地的做法和真实结果”，不是目标状态。
