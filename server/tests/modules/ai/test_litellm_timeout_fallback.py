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
    # The real second-provider budget has a 15 s floor; keep it short so the fallback also hangs.
    import ee.modules.ai.utils.sql_gen_budget as budget

    monkeypatch.setattr(budget, "timeout_fallback_for", lambda t: 0.2)

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


@pytest.mark.asyncio
async def test_stream_fails_over_on_no_first_token_long_before_full_timeout(monkeypatch):
    """A provider that never sends a first token is abandoned after
    LLM_FIRST_TOKEN_TIMEOUT_S, not after the whole budget (live: 35s of silence)."""
    import time as _t

    class _Stalled:
        def __aiter__(self):
            return self._gen()

        async def _gen(self):
            await asyncio.sleep(30)
            yield None

    class _Ok:
        def __aiter__(self):
            return self._gen()

        async def _gen(self):
            import types
            yield types.SimpleNamespace(choices=[types.SimpleNamespace(delta=types.SimpleNamespace(content="fast answer"))])

    async def fake_acompletion(**params):
        return _Stalled() if "deepseek" in params.get("model", "") else _Ok()

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)
    monkeypatch.setenv("LLM_FIRST_TOKEN_TIMEOUT_S", "2")
    service = _make_service()
    got = []

    async def _cb(piece):
        got.append(piece)

    t0 = _t.monotonic()
    result = await service.generate_completion_with_stream_callback(
        prompt="hello", system_context="sys", stream_callback=_cb, model_id="fake_slow", timeout=25,
    )
    assert result.get("success") is True
    assert "".join(got) == "fast answer"
    assert _t.monotonic() - t0 < 8, "must fail over on the first-token budget, not the 25s timeout"


def test_first_token_watchdog_is_model_aware(monkeypatch):
    from ee.modules.ai.services.litellm_service import _first_token_timeout_s

    monkeypatch.setenv("LLM_FIRST_TOKEN_TIMEOUT_S", "10")
    assert _first_token_timeout_s({"tier": "fast"}) == 10.0
    assert _first_token_timeout_s({"tier": "reasoning"}) is None   # may think silently
    assert _first_token_timeout_s({"is_local": True}) is None      # may be loading weights
    assert _first_token_timeout_s({"tier": "reasoning", "first_token_timeout_s": 45}) == 45.0


@pytest.mark.asyncio
async def test_thinking_models_get_budget_headroom_low_effort_and_empty_answers_fail(monkeypatch):
    """A thinking model (GLM-5 flash) that spends the whole budget reasoning must not be
    reported as a successful empty answer; narration can ask it to think less; and the
    stream gets the same reasoning headroom as the non-streaming call."""
    import types

    seen = {}

    class _Reasoning:
        def __aiter__(self):
            return self._gen()

        async def _gen(self):
            delta = types.SimpleNamespace(content=None, reasoning_content="thinking " * 50)
            yield types.SimpleNamespace(choices=[types.SimpleNamespace(delta=delta)])

    async def fake_acompletion(**params):
        seen.update(params)
        return _Reasoning()

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)
    service = _make_service()
    service.available_models["glm"] = {"name": "GLM", "model": "openrouter/z-ai/glm-5.3-flash",
                                       "provider": "openrouter", "api_key": "k", "max_tokens": 16384}

    async def _cb(piece):
        pass

    result = await service.generate_completion_with_stream_callback(
        prompt="p", system_context="s", stream_callback=_cb, model_id="glm", max_tokens=4096,
        timeout=5, reasoning_effort="low", _disable_timeout_fallback=True,
    )
    assert result["success"] is False and result.get("reasoning_exhausted") is True
    assert (seen.get("max_tokens") or seen.get("max_completion_tokens")) >= 16384  # headroom, not 4096
    assert (seen.get("extra_body") or {}).get("reasoning") == {"effort": "low"}


@pytest.mark.asyncio
async def test_slow_first_token_waits_when_there_is_nowhere_to_fail_over(monkeypatch):
    """The org's own key (BYOK) has no failover: a first-token cut-off only turned a slow start
    into a failure (live: a Decide brief lost at 10s of a 90s budget). It waits instead."""
    import types

    class _SlowStart:
        def __aiter__(self):
            return self._gen()

        async def _gen(self):
            await asyncio.sleep(2.5)
            yield types.SimpleNamespace(choices=[types.SimpleNamespace(delta=types.SimpleNamespace(content="the brief"))])

    async def fake_acompletion(**params):
        return _SlowStart()

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)
    monkeypatch.setenv("LLM_FIRST_TOKEN_TIMEOUT_S", "1")
    service = _make_service()
    service.available_models["byok_slow"] = {**service.available_models["fake_slow"], "byok_provider": "google"}

    async def _cb(_piece):
        return None

    result = await service.generate_completion_with_stream_callback(
        prompt="hello", system_context="sys", stream_callback=_cb, model_id="byok_slow", timeout=20,
    )
    assert result.get("success") is True and result.get("content") == "the brief"
