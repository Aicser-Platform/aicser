"""Torch-free model wrapper and permissively licensed PDF helpers."""

import numpy as np

from src.shared import onnx_models, pdf


class _Encoded:
    def __init__(self, ids):
        self.ids, self.attention_mask, self.type_ids = ids, [1 if i else 0 for i in ids], [0] * len(ids)


class _Tokenizer:
    def encode_batch(self, texts):
        longest = max(len(t) for t in texts)
        return [_Encoded([1] * len(t) + [0] * (longest - len(t))) for t in texts]


class _Input:
    def __init__(self, name):
        self.name = name


class _Session:
    def get_inputs(self):
        return [_Input("input_ids"), _Input("attention_mask")]  # no token_type_ids, like some exports

    def run(self, _, inputs):
        n, length = inputs["input_ids"].shape
        hidden = np.ones((n, length, 3))
        hidden[..., 2] = 5  # padding must not move the average: every real token is the same
        hidden[inputs["attention_mask"] == 0] = 100
        return [hidden]


def _encoder(truncate=None):
    enc = onnx_models.OnnxEncoder.__new__(onnx_models.OnnxEncoder)
    enc.model_name, enc.truncate_dim, enc._session, enc._tokenizer = "m", truncate, _Session(), _Tokenizer()
    return enc


def test_mean_pooling_ignores_padding_and_keeps_order():
    out = _encoder().encode(["a", "abcd", "ab"])
    assert out.shape == (3, 3)
    assert np.allclose(out, [[1, 1, 5]] * 3)


def test_truncates_before_normalizing():
    out = _encoder(truncate=2).encode(["ab"], normalize_embeddings=True)
    assert out.shape == (1, 2)
    assert np.isclose(np.linalg.norm(out[0]), 1.0)


def test_single_text_returns_one_vector():
    assert _encoder().encode("ab").shape == (3,)


def test_table_markdown_escapes_and_handles_empty_cells():
    md = pdf._markdown([["Line", "OEE"], ["A|B", None], ["2\nshift", "81%"]])
    assert md.splitlines() == ["| Line | OEE |", "| --- | --- |", "| A\\|B |  |", "| 2 shift | 81% |"]
