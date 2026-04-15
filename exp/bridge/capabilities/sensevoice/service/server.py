import argparse
import base64
import os
import tempfile
import time
from functools import lru_cache
from pathlib import Path

import numpy as np
import soundfile as sf
import uvicorn
from fastapi import FastAPI
from funasr import AutoModel
from funasr.utils.postprocess_utils import rich_transcription_postprocess
from pydantic import BaseModel


CAPABILITY_ROOT = Path(__file__).resolve().parents[1]
LOCAL_ROOT = CAPABILITY_ROOT / ".local"
MODELS_ROOT = LOCAL_ROOT / "models"
CACHE_ROOT = LOCAL_ROOT / "cache"
MODEL_PATH = MODELS_ROOT / "SenseVoiceSmall"


def parse_args():
    parser = argparse.ArgumentParser(description="Bridge SenseVoice Small local server")
    parser.add_argument("--host", default=os.environ.get("SENSEVOICE_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("SENSEVOICE_PORT", "8010")))
    parser.add_argument("--device", default=os.environ.get("SENSEVOICE_DEVICE", "cpu"))
    parser.add_argument("--language", default=os.environ.get("SENSEVOICE_LANGUAGE", "auto"))
    return parser.parse_args()


ARGS = parse_args()


def ensure_ready():
    # 启动前确认模型和本地缓存目录已经落到项目内，避免运行时误写到系统目录。
    required_paths = [LOCAL_ROOT, CACHE_ROOT, MODEL_PATH]
    missing = [str(item) for item in required_paths if not item.exists()]
    if missing:
        raise RuntimeError(
            "SenseVoice 本地部署不完整，请先运行 capabilities/sensevoice/setup.ps1。\n"
            + "\n".join(missing)
        )


ensure_ready()


class TranscribeRequest(BaseModel):
    audio_base64: str
    format: str = "wav"
    stream: bool = False
    use_vad: bool = False
    chunk_duration_ms: int = 600


def resolve_device():
    # 目前默认走 CPU，只有显式指定并且环境支持时才切到 GPU。
    requested = str(ARGS.device or "cpu").strip().lower()
    if requested in {"cpu", "cuda"}:
        return requested
    return "cpu"


@lru_cache(maxsize=2)
def get_model(use_vad=False):
    # 按识别模式缓存模型实例，避免切换 VAD 后重复初始化。
    if use_vad:
        return AutoModel(
            model=str(MODEL_PATH),
            vad_model="fsmn-vad",
            vad_kwargs={"max_single_segment_time": 30000},
            device=resolve_device(),
            hub="hf",
            disable_update=True,
        )

    return AutoModel(
        model=str(MODEL_PATH),
        device=resolve_device(),
        hub="hf",
        disable_update=True,
    )


def extract_text_from_result(result):
    # FunASR 返回结构可能随版本略有差异，这里统一抽取出可展示文本。
    if isinstance(result, list) and result:
        item = result[0]
    else:
        item = result

    if isinstance(item, dict):
        text = item.get("text") or item.get("sentence_info") or ""
        if isinstance(text, list):
            return " ".join(str(part) for part in text if part).strip()
        return str(text).strip()

    return str(item or "").strip()


def transcribe_audio_file(audio_path, use_vad=False):
    # 非流式模式直接跑整段音频，适合验证最终完整文本。
    generate_kwargs = {
        "input": str(audio_path),
        "cache": {},
        "language": ARGS.language,
        "use_itn": True,
    }
    if use_vad:
        generate_kwargs.update({
            "batch_size_s": 60,
            "merge_vad": True,
            "merge_length_s": 15,
        })
    else:
        generate_kwargs["batch_size"] = 1

    result = get_model(use_vad).generate(**generate_kwargs)
    return {
        "text": rich_transcription_postprocess(extract_text_from_result(result)),
        "raw_result": result,
    }


def normalize_audio_samples(audio_path):
    # 流式测试前先统一成单声道 float32，便于稳定按窗口切块。
    audio_data, sample_rate = sf.read(str(audio_path), dtype="float32", always_2d=False)
    if isinstance(audio_data, np.ndarray) and audio_data.ndim > 1:
        audio_data = np.mean(audio_data, axis=1)
    return np.asarray(audio_data, dtype="float32"), int(sample_rate)


def transcribe_audio_stream(audio_path, chunk_duration_ms=600, use_vad=False):
    # SenseVoice 不是原生流式模型，这里按固定时间窗切块做开发者流式测试。
    audio_data, sample_rate = normalize_audio_samples(audio_path)
    chunk_size = max(int(sample_rate * max(chunk_duration_ms, 200) / 1000), 1)
    chunks = []
    chunk_texts = []

    for index, start in enumerate(range(0, len(audio_data), chunk_size)):
        end = min(start + chunk_size, len(audio_data))
        started_at = time.time()
        result = get_model(use_vad).generate(
            input=audio_data[start:end],
            cache={},
            language=ARGS.language,
            use_itn=True,
            batch_size=1,
        )
        text = rich_transcription_postprocess(extract_text_from_result(result))
        chunk_texts.append(text)
        chunks.append({
            "index": index,
            "start_ms": round(start * 1000 / sample_rate),
            "end_ms": round(end * 1000 / sample_rate),
            "latency_ms": round((time.time() - started_at) * 1000),
            "text": text,
        })

    return {
        "text": " ".join(part for part in chunk_texts if part).strip(),
        "raw_result": chunks,
        "chunks": chunks,
    }


app = FastAPI(title="Bridge SenseVoice Server")


@app.get("/probe/")
async def probe():
    return {
        "ok": True,
        "message": "Bridge SenseVoice local server ready",
        "device": resolve_device(),
        "mode": "sensevoice-small",
        "modelPath": str(MODEL_PATH),
    }


@app.post("/transcribe/")
async def transcribe(request: TranscribeRequest):
    suffix = f".{(request.format or 'wav').strip().lower()}"
    temp_audio_path = None

    try:
        # 请求边界只接收 base64 音频，便于 Electron 侧直接复用现有录音文件。
        audio_bytes = base64.b64decode(request.audio_base64)
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(audio_bytes)
            temp_audio_path = Path(temp_file.name)

        started_at = time.time()
        if request.stream:
            result = transcribe_audio_stream(
                temp_audio_path,
                chunk_duration_ms=request.chunk_duration_ms,
                use_vad=request.use_vad,
            )
        else:
            result = transcribe_audio_file(temp_audio_path, use_vad=request.use_vad)
        latency = time.time() - started_at

        return {
            "ok": True,
            "latency": latency,
            "mode": "sensevoice-small",
            "stream": request.stream,
            "use_vad": request.use_vad,
            "language": ARGS.language,
            "text": result["text"],
            "chunks": result.get("chunks", []),
            "raw_result": result["raw_result"],
        }
    finally:
        # 临时音频文件只在服务端短暂落地，识别完成后立即清理。
        if temp_audio_path and temp_audio_path.exists():
            temp_audio_path.unlink(missing_ok=True)


if __name__ == "__main__":
    uvicorn.run(app, host=ARGS.host, port=ARGS.port)
