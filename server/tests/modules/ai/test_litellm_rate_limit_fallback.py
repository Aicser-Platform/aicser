"""Regression tests: a rate-limited/deactivated-route model must get the same
automatic fallback-to-a-working-model treatment an auth failure already gets,
in both the non-streaming and streaming completion paths.

Root cause this guards against: live-reproduced this session, the platform
default model (primary_override, TokenHarbor's deepseek-v4-flash:free) failed
outright with litellm.RateLimitError ("free route ... is not active",
status_code=429) with zero automatic recovery -- while the three azure_*
model ids succeeded via get_fallback_model_id()'s retry chain, purely because
their failures happened to be AuthenticationErrors, which was the only
failure type wired to that fallback. generate_streaming_completion had NO
fallback logic at all (any exception just yielded an "Error: " string) --
callers like rag_retrieval_node.py did their own manual single retry, which
in the reproduced case retried the SAME dead model and failed again.
"""

import pytest

from ee.modules.ai.services import litellm_service as svc_mod
from ee.modules.ai.services.litellm_service import LiteLLMService


class RateLimitError(Exception):
    """Mimics litellm's RateLimitError shape. Name matters: code checks __name__."""

    def __init__(self, message="OpenAIException - The free route 'deepseek-v4-flash:free' is not active."):
        super().__init__(message)
        self.status_code = 429


_FAKE_MODELS = {
    "fake_primary": {
        "name": "Primary Free Route",
        "model": "deepseek-v4-flash:free",
        "provider": "openai",
        "api_key": "thk_live_fake_key",
        "max_tokens": 8192,
    },
    "fake_backup": {
        "name": "Backup Reasoning",
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
    service.default_model = "fake_primary"
    service.active_model = "fake_primary"
    service._model_availability_cache = {}
    service._model_cache_timestamps = {}
    return service


@pytest.mark.asyncio
async def test_generate_completion_falls_back_on_rate_limit(monkeypatch):
    calls = {"primary": 0, "backup": 0}

    async def fake_acompletion(**params):
        model = params.get("model", "")
        if "deepseek" in model:
            calls["primary"] += 1
            raise RateLimitError()
        calls["backup"] += 1
        import types

        msg = types.SimpleNamespace(content="real answer", text="real answer")
        choice = types.SimpleNamespace(message=msg)
        return types.SimpleNamespace(choices=[choice], usage=None)

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)

    service = _make_service()
    result = await service.generate_completion(
        prompt="hello", model_id="fake_primary", timeout=2.0, num_retries=0
    )

    assert calls["primary"] == 1
    assert calls["backup"] == 1
    assert result.get("success") is True
    assert result.get("content") == "real answer"


@pytest.mark.asyncio
async def test_generate_streaming_completion_falls_back_on_rate_limit(monkeypatch):
    calls = {"primary": 0, "backup": 0}

    class _FakeStream:
        def __init__(self, chunks):
            self._chunks = chunks

        def __aiter__(self):
            return self._gen()

        async def _gen(self):
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
            calls["primary"] += 1
            raise RateLimitError()
        calls["backup"] += 1
        return _FakeStream([_chunk("real "), _chunk("streamed "), _chunk("answer")])

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)

    service = _make_service()
    chunks = []
    async for chunk in service.generate_streaming_completion(
        prompt="hello", model_id="fake_primary"
    ):
        chunks.append(chunk)

    assert calls["primary"] == 1
    assert calls["backup"] == 1
    full_text = "".join(chunks)
    assert full_text == "real streamed answer"
    assert not full_text.startswith("Error:")


@pytest.mark.asyncio
async def test_generate_completion_with_tools_falls_back_on_rate_limit(monkeypatch):
    """skill_executor_node's Phase -1 skill matcher and business_journey_nodes'
    LLM phase classifier both go through this method — it had no fallback
    logic at all before, unlike generate_completion/generate_streaming_completion."""
    calls = {"primary": 0, "backup": 0}

    async def fake_acompletion(**params):
        model = params.get("model", "")
        if "deepseek" in model:
            calls["primary"] += 1
            raise RateLimitError()
        calls["backup"] += 1
        import types

        tool_call = types.SimpleNamespace(
            function=types.SimpleNamespace(name="classify_journey_phase", arguments='{"phase": "assess"}')
        )
        msg = types.SimpleNamespace(content="", tool_calls=[tool_call])
        choice = types.SimpleNamespace(message=msg)
        return types.SimpleNamespace(choices=[choice], usage=None)

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)

    service = _make_service()
    result = await service.generate_completion_with_tools(
        prompt="track progress and set up alerts",
        system_context="classify",
        tools=[{"type": "function", "function": {"name": "classify_journey_phase"}}],
        model_id="fake_primary",
    )

    assert calls["primary"] == 1
    assert calls["backup"] == 1
    assert result.get("success") is True
    assert result["tool_calls"][0]["name"] == "classify_journey_phase"
    assert result["tool_calls"][0]["arguments"] == {"phase": "assess"}


@pytest.mark.asyncio
async def test_generate_streaming_completion_does_not_loop_when_both_fail(monkeypatch):
    calls = {"primary": 0, "backup": 0}

    async def fake_acompletion(**params):
        model = params.get("model", "")
        if "deepseek" in model:
            calls["primary"] += 1
        else:
            calls["backup"] += 1
        raise RateLimitError()

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)

    service = _make_service()
    chunks = []
    async for chunk in service.generate_streaming_completion(
        prompt="hello", model_id="fake_primary"
    ):
        chunks.append(chunk)

    full_text = "".join(chunks)
    assert full_text.startswith("Error:")
    # Each model tried exactly once — no loop back to an already-failed model.
    assert calls["primary"] == 1
    assert calls["backup"] == 1
