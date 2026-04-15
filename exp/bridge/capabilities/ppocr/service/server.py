import argparse
import base64
import io
import os
import time
from functools import lru_cache
from pathlib import Path

import numpy as np
from fastapi import FastAPI
from PIL import Image, ImageDraw
from pydantic import BaseModel
import uvicorn


CAPABILITY_ROOT = Path(__file__).resolve().parents[1]
LOCAL_ROOT = CAPABILITY_ROOT / ".local"
CACHE_ROOT = LOCAL_ROOT / "cache"
PADDLE_CACHE_ROOT = CACHE_ROOT / "paddle"
PADDLEX_CACHE_ROOT = CACHE_ROOT / "paddlex"

os.environ.setdefault("PADDLE_PDX_CACHE_HOME", str(PADDLEX_CACHE_ROOT))
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

from paddleocr import PaddleOCR


DEFAULT_CPU_THREADS = max(os.cpu_count() or 4, 4)


def parse_args():
    parser = argparse.ArgumentParser(description="Bridge PP-OCRv5 mobile local server")
    parser.add_argument("--host", default=os.environ.get("PPOCR_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PPOCR_PORT", "8020")))
    parser.add_argument("--device", default=os.environ.get("PPOCR_DEVICE", "cpu"))
    parser.add_argument("--det-model-name", default=os.environ.get("PPOCR_DET_MODEL_NAME", "PP-OCRv5_mobile_det"))
    parser.add_argument("--rec-model-name", default=os.environ.get("PPOCR_REC_MODEL_NAME", "PP-OCRv5_mobile_rec"))
    parser.add_argument("--cpu-threads", type=int, default=int(os.environ.get("PPOCR_CPU_THREADS", DEFAULT_CPU_THREADS)))
    parser.add_argument(
        "--disable-mkldnn",
        action="store_true",
        default=os.environ.get("PPOCR_DISABLE_MKLDNN", "").lower() in ("1", "true", "yes"),
    )
    return parser.parse_args()


ARGS = parse_args()


def ensure_ready():
    # 启动前先校验本地能力目录，避免请求进来后才暴露部署缺失。
    required_paths = [LOCAL_ROOT, CACHE_ROOT, PADDLE_CACHE_ROOT, PADDLEX_CACHE_ROOT]
    missing = [str(item) for item in required_paths if not item.exists()]
    if missing:
        raise RuntimeError(
            "PP-OCR 部署不完整，请先运行 capabilities/ppocr/setup.ps1。\n"
            + "\n".join(missing)
        )


ensure_ready()


class ParseRequest(BaseModel):
    base64_image: str
    # 默认不再回传标注图，前端只需要结构化文本行；调试时可显式打开。
    include_annotated: bool = False


def encode_image_to_base64(image: Image.Image):
    buffered = io.BytesIO()
    image.save(buffered, format="PNG")
    return base64.b64encode(buffered.getvalue()).decode("utf-8")


def to_builtin_value(value):
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, dict):
        return {key: to_builtin_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_builtin_value(item) for item in value]
    return value


def safe_get_mapping(value):
    if isinstance(value, dict):
        return to_builtin_value(value)
    if hasattr(value, "keys"):
        try:
            return {key: to_builtin_value(value[key]) for key in value.keys()}
        except Exception:
            pass
    if hasattr(value, "res") and isinstance(value.res, dict):
        return to_builtin_value(value.res)
    if hasattr(value, "json"):
        json_value = value.json
        if isinstance(json_value, dict):
            return to_builtin_value(json_value)
    if hasattr(value, "to_dict"):
        converted = value.to_dict()
        if isinstance(converted, dict):
            return to_builtin_value(converted)
    return {}


def normalize_polygon(points):
    if isinstance(points, np.ndarray):
        points = points.tolist()
    normalized = []
    for point in (points if points is not None else []):
        if isinstance(point, (list, tuple)) and len(point) >= 2:
            normalized.append([int(round(float(point[0]))), int(round(float(point[1])))])
    return normalized


def polygon_to_bbox(polygon):
    xs = [point[0] for point in polygon]
    ys = [point[1] for point in polygon]
    return [min(xs), min(ys), max(xs), max(ys)]


def extract_polygons(raw_result):
    # 兼容 PaddleOCR 不同版本的返回字段名，统一转成多边形列表。
    for key in ("dt_polys", "rec_polys", "text_det_polys", "polys"):
        value = raw_result.get(key)
        if isinstance(value, list) and value:
            return [normalize_polygon(item) for item in value]

    boxes = raw_result.get("rec_boxes") or raw_result.get("boxes")
    if isinstance(boxes, list) and boxes:
        polygons = []
        for item in boxes:
            if isinstance(item, (list, tuple)) and len(item) >= 4:
                x1, y1, x2, y2 = [int(round(float(number))) for number in item[:4]]
                polygons.append([[x1, y1], [x2, y1], [x2, y2], [x1, y2]])
        return polygons

    return []


def extract_texts(raw_result):
    for key in ("rec_texts", "texts"):
        value = raw_result.get(key)
        if isinstance(value, np.ndarray):
            value = value.tolist()
        if isinstance(value, list):
            return [str(item or "") for item in value]
    return []


def extract_scores(raw_result):
    for key in ("rec_scores", "scores", "text_scores"):
        value = raw_result.get(key)
        if isinstance(value, np.ndarray):
            value = value.tolist()
        if isinstance(value, list):
            return [float(item) for item in value]
    return []


@lru_cache(maxsize=1)
def get_ocr_model():
    # 这里只加载 PP-OCRv5 mobile，尽量把模型体积和推理延迟压低。
    # MKLDNN 默认开启：关闭后 CPU OCR 会慢约 5 倍。曾经因 paddle 版本漂到 3.3.x 触发
    # oneDNN PIR 属性转换异常被迫关闭，现在锁到 paddlepaddle==3.0.0 后已恢复。
    return PaddleOCR(
        text_detection_model_name=ARGS.det_model_name,
        text_recognition_model_name=ARGS.rec_model_name,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        enable_mkldnn=not ARGS.disable_mkldnn,
        cpu_threads=ARGS.cpu_threads,
        device=ARGS.device,
    )


def build_ocr_lines(image: Image.Image):
    # 统一把 PaddleOCR 原始结果整理成前端可展示的文本行结构。
    image_np = np.array(image)
    prediction = get_ocr_model().predict(image_np)
    first_result = prediction[0] if isinstance(prediction, list) and prediction else {}
    raw_result = safe_get_mapping(first_result)
    polygons = extract_polygons(raw_result)
    texts = extract_texts(raw_result)
    scores = extract_scores(raw_result)

    lines = []
    for index, polygon in enumerate(polygons):
        if not polygon:
            continue
        bbox = polygon_to_bbox(polygon)
        lines.append(
            {
                "id": index,
                "text": texts[index] if index < len(texts) else "",
                "score": scores[index] if index < len(scores) else None,
                "polygon": polygon,
                "bbox": bbox,
            }
        )

    return lines, raw_result


def draw_ocr_overlay(image: Image.Image, lines):
    # 识别结果使用线框回画到截图上，方便快速比对 OCR 定位是否准确。
    annotated = image.copy()
    drawer = ImageDraw.Draw(annotated)
    for line in lines:
        polygon = line["polygon"]
        if len(polygon) < 2:
            continue
        stroke = polygon + [polygon[0]]
        drawer.line(stroke, fill="#38bdf8", width=3)
        label_x = min(point[0] for point in polygon)
        label_y = max(0, min(point[1] for point in polygon) - 16)
        drawer.text((label_x, label_y), f'{line["id"]}: {line["text"][:24]}', fill="#38bdf8")
    return annotated


app = FastAPI(title="Bridge PP-OCRv5 Mobile Server")


@app.get("/probe/")
async def probe():
    return {
        "ok": True,
        "message": "Bridge PP-OCR server ready",
        "device": ARGS.device,
        "detModel": ARGS.det_model_name,
        "recModel": ARGS.rec_model_name,
        "cacheRoot": str(CACHE_ROOT),
    }


@app.post("/parse/")
async def parse_image(request: ParseRequest):
    # 服务边界统一接收 base64 图片，便于 Electron 侧直接复用截图结果。
    image_bytes = base64.b64decode(request.base64_image)
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    started_at = time.time()
    ocr_lines, _ = build_ocr_lines(image)
    inference_latency = time.time() - started_at

    response = {
        "ok": True,
        "latency": inference_latency,
        "mode": "ppocrv5-mobile",
        "line_count": len(ocr_lines),
        "ocr_lines": ocr_lines,
    }
    if request.include_annotated:
        # 可选调试通路：只在显式请求时付出整图 PNG+base64 的编码代价。
        response["annotated_image_base64"] = encode_image_to_base64(
            draw_ocr_overlay(image, ocr_lines)
        )
    return response


if __name__ == "__main__":
    uvicorn.run(app, host=ARGS.host, port=ARGS.port)
