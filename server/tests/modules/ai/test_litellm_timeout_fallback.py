"""Regression tests: a TIMEOUT (not just an outright error) must trigger the
same cross-provider fallback an auth failure or rate-limit already gets.

Root cause this guards against: a degraded-but-not-dead provider (e.g. a slow
free-tier gateway) doesn't error out -- it just runs past its timeout budget.
Before this fix, generate_completion's asyncio.wait_for TimeoutError handler
(and the equivalent timeout-shaped-exception branch) returned immediately with
'fallback': True as a label nobody ever read -- it never actually called
get_fallback_model_id(), unlike the auth_failed/rate_limited path a few lines
below it in the same function. generate_completion_with_tools had no Python-
enforced timeout at all (bare `await acompletion(...)`, relying on LiteLLM's
own timeout param which is not reliably honored) and its fallback trigger
checked only auth_failed/rate_limited, never timeouts. generate_completion_
with_stream_callback (insight_synthesizer_node.py's primary narration-stream
path) had neither a Python-enforced timeout NOR any fallback logic of any
kind -- any failure, including hanging past its nominal timeout, just
returned an error with zero recovery.

Each of these, chained across a single request's several sequential LLM
calls (NL2SQL's up to 4 attempts, insight_synthesizer's up to 2), turned one
slow provider into minutes of added latency with no automatic recovery.
"""

import asyncio

import pytest

from ee.modules.ai.services import litellm_service as svc_mod
from ee.modules.ai.services.litellm_service import LiteLLMService


_FAKE_MODELS = {
    "fake_slow": {
        "name": "Slow Free Route",
        "model": "deepseek-v4-flash:free",
        "provider": "openai",
        "api_key": "thk_live_fake_key",
        "max_tokens": 8192,
    },
    "fake_fast": {
        "name": "Fast Backup",
        "model": "azure/gpt-4.1-mini",
        "provider": "azure",
        "api_key": "azure-key",
        "api_base": "https://example.openai.azure.com/",
        "max_tokens": 16384,
    },
}


@pytest.fixture(autouse=True)
def _clean_model_availability_cache():
    from src.core.cache import cache

    probe = LiteLLMService()
    for model_id, config in _FAKE_MODELS.items():
        key = probe._model_availability_cache_key(model_id, config)
        if key:
            cache.delete(key)
    yield
    for model_id, config in _FAKE_MODELS.items():
        key = probe._model_availability_cache_key(model_id, config)
        if key:
            cache.delete(key)


def _make_service() -> LiteLLMService:
    service = LiteLLMService()
    service.available_models = dict(_FAKE_MODELS)
    service.default_model = "fake_slow"
    service.active_model = "fake_slow"
    service._model_availability_cache = {}
    service._model_cache_timestamps = {}
    return service


def _ok_response(text="real answer"):
    import types

    msg = types.SimpleNamespace(content=text, text=text)
    choice = types.SimpleNamespace(message=msg)
    return types.SimpleNamespace(choices=[choice], usage=None)


@pytest.mark.asyncio
async def test_generate_completion_falls_back_on_timeout(monkeypatch):
    calls = {"slow": 0, "fast": 0}

    async def fake_acompletion(**params):
        model = params.get("model", "")
        if "deepseek" in model:
            calls["slow"] += 1
            await asyncio.sleep(10)  # never completes within the enforced timeout
            return _ok_response("should never get here")
        calls["fast"] += 1
        return _ok_response()

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)

    service = _make_service()
    result = await service.generate_completion(
        prompt="hello", model_id="fake_slow", timeout=0.2, num_retries=0
    )

    assert calls["slow"] == 1
    assert calls["fast"] == 1, "a timeout must trigger the same cross-provider fallback as an auth failure"
    assert result.get("success") is True
    assert result.get("content") == "real answer"


@pytest.mark.asyncio
async def test_generate_completion_does_not_loop_when_both_time_out(monkeypatch):
    calls = {"slow": 0, "fast": 0}

    async def fake_acompletion(**params):
        model = params.get("model", "")
        if "deepseek" in model:
            calls["slow"] += 1
        else:
            calls["fast"] += 1
        await asyncio.sleep(10)
        return _ok_response()

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)

    service = _make_service()
    result = await service.generate_completion(
        prompt="hello", model_id="fake_slow", timeout=0.2, num_retries=0
    )

    assert result.get("success") is False
    # Each model tried exactly once -- no loop back to an already-timed-out model.
    assert calls["slow"] == 1
    assert calls["fast"] == 1


@pytest.mark.asyncio
async def test_generate_completion_with_tools_falls_back_on_timeout(monkeypatch):
    calls = {"slow": 0, "fast": 0}

    async def fake_acompletion(**params):
        model = params.get("model", "")
        if "deepseek" in model:
            calls["slow"] += 1
            await asyncio.sleep(10)
            return _ok_response()
        calls["fast"] += 1
        import types

        tool_call = types.SimpleNamespace(
            function=types.SimpleNamespace(name="pick_tool", arguments="{}")
        )
        msg = types.SimpleNamespace(content="", tool_calls=[tool_call])
        choice = types.SimpleNamespace(message=msg)
        return types.SimpleNamespace(choices=[choice], usage=None)

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)

    service = _make_service()
    result = await service.generate_completion_with_tools(
        prompt="hello",
        system_context="classify",
        tools=[{"type": "function", "function": {"name": "pick_tool"}}],
        model_id="fake_slow",
        timeout=0.2,
    )

    assert calls["slow"] == 1
    assert calls["fast"] == 1, "a timeout must trigger the same fallback generate_completion_with_tools already has for auth/rate-limit"
    assert result.get("success") is True
    assert result["tool_calls"][0]["name"] == "pick_tool"


@pytest.mark.asyncio
async def test_stream_callback_falls_back_on_timeout_before_any_chunk(monkeypatch):
    """No tokens reached the UI yet -- safe to silently retry a different model."""
    calls = {"slow": 0, "fast": 0}

    class _FakeStream:
        def __init__(self, chunks, stall_first=False):
            self._chunks = chunks
            self._stall_first = stall_first

        def __aiter__(self):
            return self._gen()

        async def _gen(self):
            if self._stall_first:
                await asyncio.sleep(10)
            for c in self._chunks:
                yield c

    def _chunk(text):
        import types

        delta = types.SimpleNamespace(content=text)
        choice = types.SimpleNamespace(delta=delta)
        return types.SimpleNamespace(choices=[choice])

    async def fake_acompletion(**params):
        model = params.get("model", "")
        if "deepseek" in model:
            calls["slow"] += 1
            return _FakeStream([_chunk("never seen")], stall_first=True)
        calls["fast"] += 1
        return _FakeStream([_chunk("real "), _chunk("answer")])

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)

    service = _make_service()
    streamed = []

    async def _cb(piece):
        streamed.append(piece)

    result = await service.generate_completion_with_stream_callback(
        prompt="hello",
        system_context="sys",
        stream_callback=_cb,
        model_id="fake_slow",
        timeout=0.2,
    )

    assert calls["slow"] == 1
    assert calls["fast"] == 1, "a pre-first-chunk timeout must fall back like the other completion paths"
    assert result.get("success") is True
    assert "".join(streamed) == "real answer"


@pytest.mark.asyncio
async def test_stream_callback_does_not_fall_back_after_partial_stream(monkeypatch):
    """Once tokens already reached the UI, silently restarting with another model
    would duplicate/garble what the user already saw -- must NOT retry."""
    calls = {"slow": 0, "fast": 0}

    class _FakeStream:
        def __aiter__(self):
            return self._gen()

        async def _gen(self):
            import types

            delta = types.SimpleNamespace(content="partial ")
            choice = types.SimpleNamespace(delta=delta)
            yield types.SimpleNamespace(choices=[choice])
            await asyncio.sleep(10)  # stalls mid-stream, after a chunk already flowed

    async def fake_acompletion(**params):
        model = params.get("model", "")
        if "deepseek" in model:
            calls["slow"] += 1
            return _FakeStream()
        calls["fast"] += 1
        raise AssertionError("must not fall back once a chunk has already streamed")

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)

    service = _make_service()
    streamed = []

    async def _cb(piece):
        streamed.append(piece)

    result = await service.generate_completion_with_stream_callback(
        prompt="hello",
        system_context="sys",
        stream_callback=_cb,
        model_id="fake_slow",
        timeout=0.2,
    )

    assert calls["slow"] == 1
    assert calls["fast"] == 0
    assert result.get("success") is False
    assert streamed == ["partial "]
