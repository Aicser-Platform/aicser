"""Chat can show the model's thinking live: reasoning pieces stream apart from the answer."""

import types

import pytest

from ee.modules.ai.services import litellm_service as LS


class _Stream:
    def __init__(self, deltas):
        self.deltas = deltas

    def __aiter__(self):
        self._it = iter(self.deltas)
        return self

    async def __anext__(self):
        try:
            d = next(self._it)
        except StopIteration:
            raise StopAsyncIteration
        return types.SimpleNamespace(choices=[types.SimpleNamespace(delta=types.SimpleNamespace(**d))])


@pytest.mark.asyncio
async def test_reasoning_streams_apart_from_the_answer(monkeypatch):
    svc = LS.LiteLLMService.__new__(LS.LiteLLMService)
    svc.default_model = "m"

    async def config(model_id=None):
        return {"provider": "openrouter", "model": "openrouter/x", "api_key": "k", "max_tokens": 1000}

    async def fake_acompletion(**kw):
        assert kw.get("stream") is True
        return _Stream([{"reasoning_content": "The schema has loans", "content": None},
                        {"reasoning_content": None, "content": "Your portfolio "},
                        {"reasoning_content": None, "content": "has 7 tables."}])

    monkeypatch.setattr(svc, "_get_model_config", config, raising=False)
    monkeypatch.setattr(LS, "acompletion", fake_acompletion)
    pieces = [p async for p in svc.generate_streaming_completion(prompt="q", include_reasoning=True)]
    thinking = [p for p in pieces if isinstance(p, LS.ReasoningChunk)]
    answer = "".join(p for p in pieces if not isinstance(p, LS.ReasoningChunk))
    assert thinking == ["The schema has loans"] and answer == "Your portfolio has 7 tables."

    plain = [p async for p in svc.generate_streaming_completion(prompt="q")]
    assert not any(isinstance(p, LS.ReasoningChunk) for p in plain)
