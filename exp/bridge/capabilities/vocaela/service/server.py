import argparse
import base64
import io
import json
import os
import re
import time
from functools import lru_cache
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel


CAPABILITY_ROOT = Path(__file__).resolve().parents[1]
LOCAL_ROOT = CAPABILITY_ROOT / ".local"
CACHE_ROOT = LOCAL_ROOT / "cache"
HF_HOME = CACHE_ROOT / "hf"
HF_HUB_CACHE = HF_HOME / "hub"
MODELS_ROOT = LOCAL_ROOT / "models"
MODEL_PATH = MODELS_ROOT / "Vocaela-2-500M-1024R2"


# 在导入 transformers 之前把 HF 缓存路径钉到项目内部，避免它落到 %USERPROFILE%。
os.environ.setdefault("HF_HOME", str(HF_HOME))
os.environ.setdefault("HUGGINGFACE_HUB_CACHE", str(HF_HUB_CACHE))


# Vocaela 计算机用 system 提示取自 model card，保持和训练期一致最稳。
COMPUTER_USE_SYSTEM_MESSAGE = """You are an assistant trained to navigate the computer screen.
Given a task instruction, a screen observation, and an action history sequence,
output the next actions and wait for the next observation.

## Allowed ACTION_TYPEs and parameters:
1. `PRESS_KEY`: Press one specified key. Two parameters: `key`, string, the single key to press; `presses`, integer, the number of times to press the key (default is 1).
2. `TYPE`: Type a string into an element. Parameter: `text`, string, the text to type.
3. `MOUSE_MOVE`: Move the mouse cursor to a specified position. Parameter: `coordinate`, formatted as [x,y], the position to move the cursor to.
4. `CLICK`: Click left mouse button once on an element. Parameter: `coordinate`, formatted as [x,y], the position to click on.
5. `DRAG`: Drag the cursor with the left mouse button pressed, start and end positions are specified. Two parameters: `coordinate`, formatted as [x,y], the start position to drag from; `coordinate2`, formatted as [x2,y2], the end position to drag to.
6. `RIGHT_CLICK`: Click right mouse button once on an element. Parameter: `coordinate`, formatted as [x,y], the position to right click on.
7. `MIDDLE_CLICK`: Click middle mouse button once on an element. Parameter: `coordinate`, formatted as [x,y], the position to middle click on.
8. `DOUBLE_CLICK`: Click left mouse button twice on an element. Parameter: `coordinate`, formatted as [x,y], the position to double click on.
9. `SCROLL`: Scroll the screen (via mouse wheel). Parameter: `scroll_direction`, the direction (`up`/`down`/`left`/`right`) to scroll.
10. `HOTKEY`: Press a combination of keys simultaneously. Parameter: `hotkeys`, list of strings, the keys to press together.
11. `ANSWER`: Answer a specific question. Required parameter: `text`, string, the answer text.

* NOTE *: The `coordinate` and `coordinate2` parameters (formatted as [x,y]) are the relative coordinates on the screenshot scaled to range of 0-1, [0,0] is the top-left corner and [1,1] is the bottom-right corner.

## Format your response as
<Action>the next actions</Action>

`The next actions` can be one or multiple actions. Format `the next actions` as a JSON array of objects as below, each object is an action:
[{"action": "<ACTION_TYPE>", "key": "<key>", "presses": <presses>, "hotkeys": ["<hotkeys>"], "text": "<text>", "coordinate": [x,y], "coordinate2": [x2,y2], "scroll_direction": "<scroll_direction>"}]

If a parameter is not applicable, don't include it in the JSON object.
"""


def parse_args():
    parser = argparse.ArgumentParser(description="Bridge Vocaela-2-500M-1024R2 local server")
    parser.add_argument("--host", default=os.environ.get("VOCAELA_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("VOCAELA_PORT", "8030")))
    parser.add_argument("--device", default=os.environ.get("VOCAELA_DEVICE", "gpu"))
    parser.add_argument("--model-path", default=os.environ.get("VOCAELA_MODEL_PATH", str(MODEL_PATH)))
    parser.add_argument(
        "--attn-impl",
        default=os.environ.get("VOCAELA_ATTN_IMPL", "sdpa"),
        help="transformers attn_implementation, e.g. sdpa / eager / flash_attention_2",
    )
    return parser.parse_args()


ARGS = parse_args()


def normalize_device(device):
    # Vocaela 在 CPU 上可跑但明显慢于 GPU，默认跟 sensevoice / ppocr 保持统一的 gpu 入口。
    normalized = str(device or "gpu").strip().lower()
    return "cuda" if normalized in ("gpu", "cuda", "cuda:0", "0") else "cpu"


ARGS.device = normalize_device(ARGS.device)
MODEL_DIR = Path(ARGS.model_path).expanduser().resolve()


def ensure_ready():
    # 启动前确认模型权重已经下载完成，避免请求进来后才暴露部署缺失。
    required_paths = [LOCAL_ROOT, CACHE_ROOT, MODEL_DIR, MODEL_DIR / "config.json"]
    missing = [str(item) for item in required_paths if not item.exists()]
    if missing:
        raise RuntimeError(
            "Vocaela 本地部署不完整，请先运行 capabilities/vocaela/setup.ps1。\n"
            + "\n".join(missing)
        )


ensure_ready()


# 放在 ensure_ready 之后再 import 重量依赖，启动报错时信息更直接。
import torch  # noqa: E402
from transformers import AutoModelForImageTextToText, AutoProcessor  # noqa: E402


class ParseRequest(BaseModel):
    base64_image: str
    instruction: str
    # 默认使用 model card 提供的 computer-use system message；调试时可以显式覆盖。
    system_prompt: str | None = None
    max_new_tokens: int = 96
    # Vocaela 默认贪心解码，这里提供一个可选 sampling 开关方便做采样实验。
    do_sample: bool = False
    temperature: float = 1.0


def resolve_torch_dtype():
    # fp16 在 4070 / 4090 等 GPU 上直接跑；CPU 路线走 fp32 更稳妥。
    if ARGS.device == "cuda":
        return torch.float16
    return torch.float32


@lru_cache(maxsize=1)
def load_model():
    # 统一从本地目录加载，避免 online 校验；attn_implementation 可被命令行覆盖。
    model = AutoModelForImageTextToText.from_pretrained(
        str(MODEL_DIR),
        torch_dtype=resolve_torch_dtype(),
        _attn_implementation=ARGS.attn_impl,
    ).to(ARGS.device)
    model.eval()
    return model


@lru_cache(maxsize=1)
def load_processor():
    return AutoProcessor.from_pretrained(str(MODEL_DIR))


def decode_image(base64_image):
    try:
        image_bytes = base64.b64decode(base64_image, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid base64 image: {exc}") from exc
    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Cannot open image: {exc}") from exc
    return image


# 模型输出形如：<Action>[{"action":"click","coordinate":[0.12,0.34]}]</Action>
# 这里用非贪婪匹配把 <Action>...</Action> 抽出来，失败时再退化到 raw_text。
ACTION_BLOCK_RE = re.compile(r"<Action>\s*(.*?)\s*</Action>", re.DOTALL | re.IGNORECASE)


def extract_action_text(raw_text):
    match = ACTION_BLOCK_RE.search(raw_text)
    if not match:
        return None
    return match.group(1).strip()


def parse_actions(action_text):
    if not action_text:
        return []
    try:
        data = json.loads(action_text)
    except json.JSONDecodeError:
        return []
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    if isinstance(data, dict):
        return [data]
    return []


def denormalize_actions(actions, image_size):
    # 把 [0,1] 归一化坐标还原成像素坐标，前端 click_at 直接消费像素；原归一化字段保留用于对照。
    width, height = image_size
    pixel_actions = []
    for item in actions:
        pixel_item = dict(item)
        for key in ("coordinate", "coordinate2"):
            value = pixel_item.get(key)
            if isinstance(value, (list, tuple)) and len(value) >= 2:
                try:
                    nx, ny = float(value[0]), float(value[1])
                except (TypeError, ValueError):
                    continue
                pixel_item[f"{key}_pixel"] = [int(round(nx * width)), int(round(ny * height))]
        pixel_actions.append(pixel_item)
    return pixel_actions


def build_messages(system_prompt, instruction, image):
    effective_system = system_prompt or COMPUTER_USE_SYSTEM_MESSAGE
    # apply_chat_template 要求 content 永远是 list，这条约束来自 model card README。
    return [
        {
            "role": "system",
            "content": [{"type": "text", "text": effective_system}],
        },
        {
            "role": "user",
            "content": [
                {"type": "image", "image": image},
                {"type": "text", "text": instruction},
            ],
        },
    ]


def run_inference(image, instruction, system_prompt, max_new_tokens, do_sample, temperature):
    processor = load_processor()
    model = load_model()

    messages = build_messages(system_prompt, instruction, image)
    inputs = processor.apply_chat_template(
        messages,
        add_generation_prompt=True,
        tokenize=True,
        return_dict=True,
        return_tensors="pt",
    )
    inputs = inputs.to(model.device, dtype=resolve_torch_dtype())

    generate_kwargs = {
        "max_new_tokens": max(16, min(int(max_new_tokens or 96), 512)),
        "do_sample": bool(do_sample),
    }
    if do_sample:
        generate_kwargs["temperature"] = max(0.01, float(temperature or 1.0))

    input_len = inputs["input_ids"].shape[-1]
    with torch.inference_mode():
        generated_ids = model.generate(**inputs, **generate_kwargs)

    # 只保留新生成的 token，避免 prompt 也被回传。
    new_token_ids = generated_ids[:, input_len:]
    raw_text = processor.batch_decode(new_token_ids, skip_special_tokens=True)[0]
    return raw_text.strip()


app = FastAPI(title="Bridge Vocaela-2-500M-1024R2 Server")


@app.get("/probe/")
async def probe():
    return {
        "ok": True,
        "message": "Bridge Vocaela server ready",
        "device": ARGS.device,
        "modelPath": str(MODEL_DIR),
        "attnImpl": ARGS.attn_impl,
        "torchDtype": str(resolve_torch_dtype()).replace("torch.", ""),
    }


@app.post("/parse/")
async def parse_image(request: ParseRequest):
    image = decode_image(request.base64_image)

    started_at = time.time()
    raw_text = run_inference(
        image=image,
        instruction=request.instruction,
        system_prompt=request.system_prompt,
        max_new_tokens=request.max_new_tokens,
        do_sample=request.do_sample,
        temperature=request.temperature,
    )
    latency = time.time() - started_at

    action_text = extract_action_text(raw_text)
    actions = parse_actions(action_text)
    pixel_actions = denormalize_actions(actions, image.size)

    return {
        "ok": True,
        "mode": "vocaela-2-500m-1024r2",
        "latency": latency,
        "image_size": [image.size[0], image.size[1]],
        "raw_text": raw_text,
        "action_text": action_text,
        "actions": pixel_actions,
    }


if __name__ == "__main__":
    uvicorn.run(app, host=ARGS.host, port=ARGS.port)
