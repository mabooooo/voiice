import argparse
import base64
import io
import os
import time
from functools import lru_cache
from pathlib import Path

import easyocr
import numpy as np
from fastapi import FastAPI
from PIL import Image, ImageDraw
from pydantic import BaseModel
from ultralytics import YOLO
import uvicorn


CAPABILITY_ROOT = Path(__file__).resolve().parents[1]
LOCAL_ROOT = CAPABILITY_ROOT / ".local"
WEIGHTS_ROOT = LOCAL_ROOT / "weights"
CACHE_ROOT = LOCAL_ROOT / "cache"
EASYOCR_CACHE_ROOT = CACHE_ROOT / "easyocr"


def parse_args():
    parser = argparse.ArgumentParser(description="Bridge OmniParser detect-only local server")
    parser.add_argument("--host", default=os.environ.get("OMNIPARSER_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("OMNIPARSER_PORT", "8000")))
    parser.add_argument("--device", default=os.environ.get("OMNIPARSER_DEVICE", "cuda"))
    parser.add_argument("--box-threshold", type=float, default=float(os.environ.get("OMNIPARSER_BOX_THRESHOLD", "0.05")))
    parser.add_argument("--model-subdir", default=os.environ.get("OMNIPARSER_MODEL_SUBDIR", "icon_detect"))
    parser.add_argument("--imgsz", type=int, default=int(os.environ.get("OMNIPARSER_IMGSZ", "1280")))
    return parser.parse_args()


ARGS = parse_args()
MODEL_PATH = WEIGHTS_ROOT / ARGS.model_subdir / "model.pt"


def ensure_ready():
    # 启动前校验模型是否已落到项目内目录，缺失时直接给出明确错误。
    required_paths = [LOCAL_ROOT, CACHE_ROOT, EASYOCR_CACHE_ROOT, MODEL_PATH]
    missing = [str(item) for item in required_paths if not item.exists()]
    if missing:
        raise RuntimeError(
            "OmniParser 检测版部署不完整，请先运行 capabilities/omniparser/setup.ps1。\n"
            + "\n".join(missing)
        )


ensure_ready()


class ParseRequest(BaseModel):
    base64_image: str


def encode_image_to_data_url(image: Image.Image):
    buffered = io.BytesIO()
    image.save(buffered, format="PNG")
    return f"data:image/png;base64,{base64.b64encode(buffered.getvalue()).decode('utf-8')}"


def is_box_inside(inner_box, outer_box):
    return (
        inner_box[0] >= outer_box[0]
        and inner_box[1] >= outer_box[1]
        and inner_box[2] <= outer_box[2]
        and inner_box[3] <= outer_box[3]
    )


def merge_ocr_text_for_box(box, ocr_items):
    # 将完全落在检测框内的 OCR 文本合并，作为检测版的可读描述。
    matched = [item["text"] for item in ocr_items if is_box_inside(item["bbox"], box)]
    return " ".join(part for part in matched if part).strip()


@lru_cache(maxsize=1)
def get_yolo_model():
    # 只加载新仓库里的 icon_detect 权重，不再引入 caption 模型。
    return YOLO(str(MODEL_PATH))


@lru_cache(maxsize=1)
def get_ocr_reader():
    # OCR 只保留 EasyOCR，减少额外重量级依赖。
    return easyocr.Reader(
        ["en"],
        gpu=False,
        model_storage_directory=str(EASYOCR_CACHE_ROOT),
        user_network_directory=str(EASYOCR_CACHE_ROOT),
    )


def detect_ocr_items(image: Image.Image):
    image_np = np.array(image)
    result = get_ocr_reader().readtext(image_np, paragraph=False, text_threshold=0.8)
    items = []
    for points, text, confidence in result:
        xs = [int(point[0]) for point in points]
        ys = [int(point[1]) for point in points]
        items.append(
            {
                "type": "text",
                "text": text,
                "confidence": float(confidence),
                "bbox": [min(xs), min(ys), max(xs), max(ys)],
            }
        )
    return items


def detect_icon_items(image: Image.Image):
    prediction = get_yolo_model().predict(
        source=image,
        conf=ARGS.box_threshold,
        imgsz=ARGS.imgsz,
        verbose=False,
    )[0]
    boxes = prediction.boxes.xyxy.tolist() if prediction.boxes is not None else []
    confidences = prediction.boxes.conf.tolist() if prediction.boxes is not None else []
    items = []
    for index, (box, confidence) in enumerate(zip(boxes, confidences, strict=False)):
        x1, y1, x2, y2 = [int(value) for value in box]
        items.append(
            {
                "type": "icon",
                "id": index,
                "confidence": float(confidence),
                "bbox": [x1, y1, x2, y2],
            }
        )
    return items


def draw_labeled_image(image: Image.Image, parsed_items):
    # 检测版只绘制编号框，方便在开发者模式里快速核对结果。
    annotated = image.copy()
    drawer = ImageDraw.Draw(annotated)
    for index, item in enumerate(parsed_items):
        x1, y1, x2, y2 = item["bbox"]
        color = "#22c55e" if item["type"] == "text" else "#f59e0b"
        drawer.rectangle([x1, y1, x2, y2], outline=color, width=3)
        drawer.text((x1 + 4, max(0, y1 - 18)), f"{index}", fill=color)
    return annotated


def build_parsed_items(image: Image.Image):
    # 先做 OCR，再做 icon 检测，并把 OCR 文本尽量贴回对应检测框。
    width, height = image.size
    ocr_items = detect_ocr_items(image)
    icon_items = detect_icon_items(image)

    parsed_items = list(ocr_items)
    for item in icon_items:
        merged_text = merge_ocr_text_for_box(item["bbox"], ocr_items)
        parsed_items.append(
            {
                **item,
                "content": merged_text or None,
                "bbox_ratio": [
                    round(item["bbox"][0] / width, 6),
                    round(item["bbox"][1] / height, 6),
                    round(item["bbox"][2] / width, 6),
                    round(item["bbox"][3] / height, 6),
                ],
            }
        )
    return parsed_items


app = FastAPI(title="Bridge OmniParser Detect Server")


@app.get("/probe/")
async def probe():
    return {
        "ok": True,
        "message": "Bridge OmniParser detect-only server ready",
        "device": ARGS.device,
        "mode": "detect-only",
        "modelPath": str(MODEL_PATH),
    }


@app.post("/parse/")
async def parse_image(request: ParseRequest):
    # 服务边界统一接收 base64 图片，便于 Electron 侧直接复用截图结果。
    image_bytes = base64.b64decode(request.base64_image)
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    started_at = time.time()
    parsed_items = build_parsed_items(image)
    annotated = draw_labeled_image(image, parsed_items)
    latency = time.time() - started_at

    return {
        "ok": True,
        "latency": latency,
        "mode": "detect-only",
        "som_image_base64": encode_image_to_data_url(annotated).split(",", 1)[1],
        "parsed_content_list": parsed_items,
        "element_count": len(parsed_items),
    }


if __name__ == "__main__":
    uvicorn.run(app, host=ARGS.host, port=ARGS.port)
