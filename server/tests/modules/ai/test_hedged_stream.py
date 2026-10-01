"""Hedged narrative stream: a slow first token races a backup model; only the winner's tokens
reach the user; a fast primary never starts a backup; reasoning models aren't hedged."""

import asyncio

import pytest

from ee.modules.ai.services import litellm_service as L


def _svc(monkeypatch, behaviours, backup="backup"):
    svc = L.LiteLLMService()
    svc.available_models = {
        "primary": {"model": "openrouter/a/primary", "api_key": "k", "provider": "openrouter", "tier": "fast"},
        "backup": {"model": "openrouter/b/backup", "api_key": "k", "provider": "openrouter", "tier": "fast"},
        "thinker": {"model": "openrouter/c/thinker", "api_key": "k", "provider": "openrouter", "tier": "reasoning"},
    }
    svc.default_model = "primary"
    calls = []

    async def resolve(mid=None):
        return mid or "primary"

    async def fake_stream(*, prompt, system_context, stream_callback, model_id=None, **kw):
        calls.append(model_id)
        delay, text = behaviours[model_id]
        try:
            await asyncio.sleep(delay)
            for tok in text:
                await stream_callback(tok)
            return {"success": True, "content": "".join(text), "model": model_id}
        except asyncio.CancelledError:
            calls.append(f"cancelled:{model_id}")
            raise

    monkeypatch.setattr(svc, "resolve_working_model_id", resolve)
    monkeypatch.setattr(svc, "generate_completion_with_stream_callback", fake_stream)
    monkeypatch.setattr(svc, "get_fallback_model_id", lambda mid, **k: backup)
    monkeypatch.setattr(svc, "_is_model_known_unavailable", lambda mid: False)
    return svc, calls


@pytest.mark.asyncio
async def test_slow_primary_loses_to_backup_and_only_winner_streams(monkeypatch):
    monkeypatch.setenv("LLM_HEDGE_AFTER_S", "0.05")
    svc, calls = _svc(monkeypatch, {"primary": (1.0, ["P1", "P2"]), "backup": (0.0, ["B1", "B2"])})
    seen = []

    async def cb(t):
        seen.append(t)

    res = await svc.generate_completion_hedged_stream("q", "sys", cb, model_id="primary")
    assert seen == ["B1", "B2"] and res["content"] == "B1B2"
    assert res["hedge_winner"] == "backup"
    await asyncio.sleep(0)
    assert "cancelled:primary" in calls


@pytest.mark.asyncio
async def test_fast_primary_never_starts_backup(monkeypatch):
    monkeypatch.setenv("LLM_HEDGE_AFTER_S", "0.5")
    svc, calls = _svc(monkeypatch, {"primary": (0.0, ["P"]), "backup": (0.0, ["B"])})
    seen = []

    async def cb(t):
        seen.append(t)

    res = await svc.generate_completion_hedged_stream("q", "sys", cb, model_id="primary")
    assert seen == ["P"] and calls == ["primary"] and res["content"] == "P"


@pytest.mark.asyncio
async def test_reasoning_models_and_disabled_hedge_use_plain_stream(monkeypatch):
    monkeypatch.setenv("LLM_HEDGE_AFTER_S", "0.05")
    svc, calls = _svc(monkeypatch, {"thinker": (0.2, ["T"]), "backup": (0.0, ["B"])})
    res = await svc.generate_completion_hedged_stream("q", "sys", lambda t: asyncio.sleep(0), model_id="thinker")
    assert calls == ["thinker"] and res["content"] == "T"
    monkeypatch.setenv("LLM_HEDGE_AFTER_S", "0")
    svc, calls = _svc(monkeypatch, {"primary": (0.2, ["P"]), "backup": (0.0, ["B"])})
    await svc.generate_completion_hedged_stream("q", "sys", lambda t: asyncio.sleep(0), model_id="primary")
    assert calls == ["primary"]


@pytest.mark.asyncio
async def test_primary_failing_fast_falls_to_backup(monkeypatch):
    monkeypatch.setenv("LLM_HEDGE_AFTER_S", "1.0")
    svc, calls = _svc(monkeypatch, {"primary": (0.0, []), "backup": (0.0, ["B"])})

    async def failing(*, prompt, system_context, stream_callback, model_id=None, **kw):
        calls.append(model_id)
        if model_id == "primary":
            return {"success": False, "error": "503"}
        await stream_callback("B")
        return {"success": True, "content": "B"}

    monkeypatch.setattr(svc, "generate_completion_with_stream_callback", failing)
    res = await svc.generate_completion_hedged_stream("q", "sys", lambda t: asyncio.sleep(0), model_id="primary")
    assert res["content"] == "B" and calls == ["primary", "backup"]
