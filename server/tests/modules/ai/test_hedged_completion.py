"""Hedged non-stream completion: backup races a slow primary; first acceptable result wins."""

import asyncio

from ee.modules.ai.services.litellm_service import LiteLLMService


def _svc(delays, results):
    svc = LiteLLMService.__new__(LiteLLMService)
    svc.available_models = {"p": {"model": "openrouter/x/primary"}, "b": {"model": "openrouter/y/backup"}}

    async def resolve(mid):
        return mid or "p"

    async def gen(model_id=None, **kw):
        await asyncio.sleep(delays[model_id])
        return results[model_id]

    svc.resolve_working_model_id = resolve
    svc.get_fallback_model_id = lambda mid, **k: "b"
    svc._is_model_known_unavailable = lambda mid: False
    svc.generate_completion = gen
    return svc


def test_fast_primary_wins_without_backup():
    svc = _svc({"p": 0.01, "b": 5}, {"p": {"success": True, "content": "P"}, "b": {"success": True, "content": "B"}})
    r = asyncio.run(svc.generate_completion_hedged(model_id="p", hedge_after_s=0.5, prompt="x"))
    assert r["content"] == "P"


def test_slow_primary_is_raced_by_backup():
    svc = _svc({"p": 2.0, "b": 0.05}, {"p": {"success": True, "content": "P"}, "b": {"success": True, "content": "B"}})
    r = asyncio.run(svc.generate_completion_hedged(model_id="p", hedge_after_s=0.1, prompt="x"))
    assert r["content"] == "B" and r["hedged"] is True


def test_unacceptable_primary_result_falls_to_backup():
    svc = _svc({"p": 0.01, "b": 0.05}, {"p": {"success": True, "content": "not json"},
                                         "b": {"success": True, "content": "{}"}})
    r = asyncio.run(svc.generate_completion_hedged(model_id="p", hedge_after_s=0.5, prompt="x",
                                                   accept=lambda r: r["content"].startswith("{")))
    assert r["content"] == "{}"
