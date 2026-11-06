"""Aicser voice transcription: Whisper (faster-whisper, MIT) on this server's own CPU.

Speech to text only, with the OpenAI-compatible route (POST /v1/audio/transcriptions) so the app
server talks to it like any transcription API. Audio never leaves the install and costs no AI credits.

Two models: WHISPER_MODEL for the final text, and a faster WHISPER_PREVIEW_MODEL (model="preview")
for the live words shown while someone is still speaking. Whisper reads 30-second windows, so a pass
costs about the same for any short clip: ~1.8 s with base, ~5.5 s with small on a laptop CPU.
"""

from __future__ import annotations

import hmac
import os
import tempfile
import threading
from typing import Dict

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from faster_whisper import WhisperModel

MODEL = os.getenv("WHISPER_MODEL", "small")
PREVIEW_MODEL = os.getenv("WHISPER_PREVIEW_MODEL", "base")
DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
API_KEY = os.getenv("WHISPER_API_KEY", "")
MAX_BYTES = int(os.getenv("WHISPER_MAX_BYTES", str(25 * 1024 * 1024)))

app = FastAPI(title="Aicser voice transcription", docs_url=None, redoc_url=None)
_models: Dict[str, WhisperModel] = {}
_lock = threading.Lock()


def _get_model(name: str = MODEL) -> WhisperModel:
    """Loaded on first use (downloaded once into the model cache volume)."""
    loaded = _models.get(name)
    if loaded is not None:  # no wait while the other model is still downloading
        return loaded
    with _lock:
        if name not in _models:
            _models[name] = WhisperModel(name, device=DEVICE, compute_type=COMPUTE_TYPE)
        return _models[name]


def _preload_all() -> None:
    _get_model(PREVIEW_MODEL)  # small download first: live words work sooner on a fresh install
    _get_model(MODEL)


@app.on_event("startup")
def _preload() -> None:
    """Download and load the model now (first start: minutes), not inside someone's first request."""
    if os.getenv("WHISPER_PRELOAD", "1") != "0":
        threading.Thread(target=_preload_all, daemon=True).start()


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model": MODEL, "preview_model": PREVIEW_MODEL,
            "loaded": MODEL in _models, "preview_loaded": PREVIEW_MODEL in _models}


@app.post("/v1/audio/transcriptions")
def transcribe(
    file: UploadFile = File(...),
    model: str = Form(""),  # "preview": the fast model; anything else: WHISPER_MODEL
    language: str = Form(""),
    authorization: str = Header(""),
) -> dict:
    if API_KEY and not hmac.compare_digest(authorization, f"Bearer {API_KEY}"):
        raise HTTPException(status_code=401, detail="Unauthorized")
    data = file.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Audio too large")
    if not data:
        return {"text": ""}
    with tempfile.NamedTemporaryFile(suffix=os.path.splitext(file.filename or "")[1] or ".wav") as tmp:
        tmp.write(data)
        tmp.flush()
        segments, _info = _get_model(PREVIEW_MODEL if model == "preview" else MODEL).transcribe(
            tmp.name,
            language=(language.split("-")[0] or None) if language else None,
            vad_filter=True,  # skip silence: no invented words on a quiet clip
            beam_size=1,
        )
        text = " ".join(segment.text.strip() for segment in segments).strip()
    return {"text": text}
