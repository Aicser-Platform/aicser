"""Local embedding and rerank models on ONNX Runtime, without PyTorch.

Same models, same outputs as sentence-transformers (mean pooling over the attention mask, optional
truncation, unit length), from the ONNX export each model publishes. PyTorch added ~1 GB to the
server image and tens of seconds to startup for these two small models.
"""
from __future__ import annotations

import os
from typing import Any, List, Optional, Sequence, Tuple

import numpy as np

_BATCH_SIZE = 32
_MAX_TOKENS = 512


def _hub_file(model_name: str, filename: str) -> str:
    """Path of a model file: the local cache first (the online revision check alone took ~30 s)."""
    from huggingface_hub import hf_hub_download

    try:
        return hf_hub_download(model_name, filename, local_files_only=True)
    except Exception:
        return hf_hub_download(model_name, filename)


def _session(model_name: str) -> Any:
    import onnxruntime as ort

    options = ort.SessionOptions()
    # Share the CPU with the web server and queries; ONNX Runtime otherwise takes every core.
    options.intra_op_num_threads = int(os.getenv("AISER_ONNX_THREADS", "2"))
    options.inter_op_num_threads = 1
    # The arena keeps the peak of the largest batch forever (~170 MB here).
    options.enable_cpu_mem_arena = False
    options.enable_mem_pattern = False
    return ort.InferenceSession(_hub_file(model_name, "onnx/model.onnx"), options, providers=["CPUExecutionProvider"])


def _tokenizer(model_name: str, max_tokens: int = _MAX_TOKENS) -> Any:
    from tokenizers import Tokenizer

    tokenizer = Tokenizer.from_file(_hub_file(model_name, "tokenizer.json"))
    tokenizer.enable_truncation(max_length=max_tokens)
    tokenizer.enable_padding()
    return tokenizer


def _inputs(session: Any, encoded: Sequence[Any]) -> dict:
    """The arrays this model's graph asks for (some have no token_type_ids)."""
    arrays = {
        "input_ids": np.array([e.ids for e in encoded], dtype=np.int64),
        "attention_mask": np.array([e.attention_mask for e in encoded], dtype=np.int64),
        "token_type_ids": np.array([e.type_ids for e in encoded], dtype=np.int64),
    }
    return {i.name: arrays[i.name] for i in session.get_inputs()}


class OnnxEncoder:
    """Sentence embeddings; `encode` matches SentenceTransformer.encode."""

    def __init__(self, model_name: str, truncate_dim: Optional[int] = None):
        self.model_name = model_name
        self.truncate_dim = truncate_dim
        self._session = _session(model_name)
        self._tokenizer = _tokenizer(model_name)

    def encode(self, texts: Sequence[str] | str, normalize_embeddings: bool = False, **_: Any) -> np.ndarray:
        single = isinstance(texts, str)
        items: List[str] = [texts] if single else list(texts)
        out: List[np.ndarray] = []
        # Sorted by length so padding stays short, restored to the caller's order below.
        order = sorted(range(len(items)), key=lambda i: len(items[i]))
        for start in range(0, len(order), _BATCH_SIZE):
            batch = self._tokenizer.encode_batch([items[i] for i in order[start:start + _BATCH_SIZE]])
            inputs = _inputs(self._session, batch)
            hidden = self._session.run(None, inputs)[0]
            mask = inputs["attention_mask"][..., None].astype(np.float32)
            out.append((hidden * mask).sum(axis=1) / np.clip(mask.sum(axis=1), 1e-9, None))
        vectors = np.concatenate(out, axis=0)[np.argsort(order)] if out else np.zeros((0, self.truncate_dim or 0))
        if self.truncate_dim:
            vectors = vectors[:, : self.truncate_dim]
        if normalize_embeddings and len(vectors):
            vectors = vectors / np.clip(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-12, None)
        return vectors[0] if single else vectors


class OnnxCrossEncoder:
    """Query/passage relevance; `predict` matches CrossEncoder.predict (raw logits)."""

    def __init__(self, model_name: str):
        self.model_name = model_name
        self._session = _session(model_name)
        self._tokenizer = _tokenizer(model_name)

    def predict(self, pairs: Sequence[Tuple[str, str]], **_: Any) -> np.ndarray:
        scores: List[np.ndarray] = []
        for start in range(0, len(pairs), _BATCH_SIZE):
            batch = self._tokenizer.encode_batch([tuple(p) for p in pairs[start:start + _BATCH_SIZE]])
            scores.append(self._session.run(None, _inputs(self._session, batch))[0].reshape(-1))
        return np.concatenate(scores) if scores else np.zeros(0)
