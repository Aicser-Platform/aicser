"""Regression tests for a live user report: "i cannot select AI model
primary with harbor deepseek? (0 balance but it shall still work i should
[be able to select it])".

Root cause: an earlier live probe against TokenHarbor while its account
balance was $0 got circuit-breaker-cached as "unavailable" for
_MODEL_AVAILABILITY_FAILURE_TTL (1 hour), via the shared Redis-backed cache
keyed by id+provider+model+api_base+api_key. That stale cache entry then did
two things to a properly-configured, explicitly-selected model:

1. get_available_models() flipped 'available' to False, which
   ModelSelector.tsx uses to disable the option in the picker outright --
   the user couldn't even click it.
2. resolve_working_model_id() / set_active_model() silently substituted a
   different model whenever the user's own explicit pick was cached-
   unavailable, even though both are documented as "respect [the user's/
   frontend's] model selection" -- so even bypassing (1), an explicit choice
   wouldn't have been honored.

BYOK models were already exempt from (2); the fix extends that same
exemption to every explicit (non-"auto") selection, and removes the
circuit-breaker check from (1) entirely -- the frontend already runs its own
live testModelConnection() per model and shows a separate warning banner if
that live check fails, so a stale health cache doesn't need to block
selection outright. The circuit breaker still fully protects the automatic/
default path and generate_completion's own in-request retry-on-actual-
failure logic (untouched by this fix -- see test_litellm_fallback_no_loop.py).
"""

import pytest

from ee.modules.ai.services.litellm_service import LiteLLMService


def _make_service_with_cached_failure(monkeypatch) -> LiteLLMService:
    monkeypatch.setenv("PRIMARY_MODEL_PROVIDER", "openai")
    monkeypatch.setenv("PRIMARY_MODEL_DEPLOYMENT_NAME", "deepseek-v4-flash")
    monkeypatch.setenv("PRIMARY_MODEL_API_KEY", "thk_live_fake_key")
    monkeypatch.setenv("PRIMARY_MODEL_ENDPOINT", "https://tokenharbor.ai/v1")

    service = LiteLLMService()
    assert "primary_override" in service.available_models

    # Simulate the exact live scenario: a real probe against this model
    # already failed once (e.g. the $0-balance error) and got cached.
    service._set_cached_model_availability(
        "primary_override", {"success": False, "error": "balance is at $0"}
    )
    assert service._is_model_known_unavailable("primary_override") is True
    return service


@pytest.mark.asyncio
async def test_explicit_selection_of_cached_unavailable_model_is_honored(monkeypatch):
    service = _make_service_with_cached_failure(monkeypatch)

    resolved = await service.resolve_working_model_id("primary_override")

    assert resolved == "primary_override"


def test_set_active_model_honors_explicit_pick_despite_cached_failure(monkeypatch):
    service = _make_service_with_cached_failure(monkeypatch)

    ok = service.set_active_model("primary_override")

    assert ok is True
    assert service.active_model == "primary_override"


def test_cached_unavailable_model_still_shown_as_available_in_picker(monkeypatch):
    service = _make_service_with_cached_failure(monkeypatch)

    models = service.get_available_models()
    entry = next(m for m in models["models"] if m["id"] == "primary_override")

    assert entry["available"] is True


@pytest.mark.asyncio
async def test_auto_default_path_is_unaffected_by_this_fix(monkeypatch):
    """The "auto"/unset path never consulted the circuit-breaker cache
    inside resolve_working_model_id to begin with (it returns
    self.active_model or self.default_model immediately) -- confirm that
    behavior is unchanged."""
    service = _make_service_with_cached_failure(monkeypatch)
    service.active_model = "primary_override"

    resolved = await service.resolve_working_model_id("auto")

    assert resolved == "primary_override"


@pytest.mark.asyncio
async def test_unconfigured_model_id_still_falls_back_to_default(monkeypatch):
    """Not a circuit-breaker case at all -- a model id that was never
    registered must still fall back to the default, unaffected by this fix."""
    service = _make_service_with_cached_failure(monkeypatch)

    resolved = await service.resolve_working_model_id("totally_made_up_model_id")

    assert resolved == service.default_model
