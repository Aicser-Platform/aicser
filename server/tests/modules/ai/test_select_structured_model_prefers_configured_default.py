"""Regression test: select_structured_model must prefer the platform's own
configured default (self.default_model) over a hardcoded Azure-only
priority list.

Root cause, live-reproduced: with TokenHarbor correctly configured as the
platform default (PRIMARY_MODEL_* env vars -> LiteLLMService.default_model
resolves to "primary_override") and Azure's own credentials stale/expired
(deploy/.env's AZURE_OPENAI_API_KEY — confirmed via a live 401
AuthenticationError from Azure), select_structured_model still tried
"azure_gpt5_mini" FIRST for every structured/accuracy-critical call
(nl2sql's fast-path SQL generation among them, the highest-traffic call
site that uses this function) — silently ignoring the platform's own
working default and routing through a dead credential instead, exactly
backwards from "use whichever default is actually configured and working."

Fixed by checking litellm_service.default_model before the hardcoded
Azure-name list, which now only serves as a last-resort fallback if
default_model itself is unset.
"""

from ee.modules.ai.services.litellm_service import LiteLLMService
from ee.modules.ai.utils.model_selector import select_structured_model


def _service_with(models: dict, default: str) -> LiteLLMService:
    service = LiteLLMService()
    service.available_models = models
    service.default_model = default
    service.active_model = default
    return service


_TOKENHARBOR_PRIMARY = {
    "name": "Primary (TokenHarbor)",
    "model": "openai/deepseek-v4-flash:free",
    "provider": "openai",
    "tier": "fast",
}
_AZURE_MINI = {
    "name": "Azure Mini",
    "model": "azure/gpt-4.1-mini",
    "provider": "azure",
    "tier": "fast",
}


def test_configured_tokenharbor_default_wins_over_hardcoded_azure_names():
    """The exact live scenario: TokenHarbor is the configured default,
    Azure is also registered (credentials present but, unknown to this
    function, invalid) — the configured default must win."""
    svc = _service_with(
        {"primary_override": _TOKENHARBOR_PRIMARY, "azure_gpt5_mini": _AZURE_MINI},
        default="primary_override",
    )
    assert select_structured_model(svc) == "primary_override"


def test_azure_still_used_when_it_is_genuinely_the_configured_default():
    """Control case: when Azure IS the actual configured default (no
    TokenHarbor/other override present), it must still be selected —
    this fix changes preference ORDER, not correctness when Azure really
    is the right choice."""
    svc = _service_with({"azure_gpt41_mini": _AZURE_MINI}, default="azure_gpt41_mini")
    assert select_structured_model(svc) == "azure_gpt41_mini"


def test_hardcoded_fallback_list_only_used_when_default_model_unset():
    """default_model can legitimately be unset (e.g. mid-init edge case) —
    the hardcoded list must still work as a last-resort, not raise."""
    svc = _service_with({"azure_gpt41_mini": _AZURE_MINI}, default="")
    svc.default_model = None
    assert select_structured_model(svc) == "azure_gpt41_mini"


def test_default_model_not_in_available_models_falls_through_to_list():
    """Defensive: a stale default_model pointing at a since-removed entry
    must not crash or return an invalid id — falls through to the
    hardcoded list like an unset default would."""
    svc = _service_with({"azure_gpt41_mini": _AZURE_MINI}, default="some_removed_model")
    assert select_structured_model(svc) == "azure_gpt41_mini"
