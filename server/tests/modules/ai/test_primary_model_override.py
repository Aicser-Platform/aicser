"""Regression tests for PRIMARY_MODEL_PROVIDER, the fast/default-tier
counterpart to the pre-existing REASONING_MODEL_PROVIDER override.

Context: get_model_for_tier's non-reasoning path, and __init__'s "Default
model selection" block, only ever picked between Azure and a plain OpenAI
fallback -- there was no way to make a third-party OpenAI-compatible gateway
(e.g. TokenHarbor, at https://tokenharbor.ai/v1) the actual default model
without deleting the Azure env vars outright, which would also throw away
Azure as a fallback/BYOK option. PRIMARY_MODEL_PROVIDER (+ _DEPLOYMENT_NAME,
_API_KEY, _ENDPOINT) mirrors REASONING_MODEL_PROVIDER's existing shape and is
checked before Azure in default-model selection.
"""

import pytest

from ee.modules.ai.services.litellm_service import LiteLLMService


def _clear_cloud_env(monkeypatch):
    for var in (
        "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT",
        "AZURE_OPENAI_GPT41_API_KEY", "AZURE_OPENAI_GPT41_ENDPOINT",
        "OPENAI_API_KEY", "PRIMARY_MODEL_PROVIDER", "PRIMARY_MODEL_DEPLOYMENT_NAME",
        "PRIMARY_MODEL_API_KEY", "PRIMARY_MODEL_ENDPOINT",
    ):
        monkeypatch.delenv(var, raising=False)


def test_primary_override_becomes_default_model(monkeypatch):
    _clear_cloud_env(monkeypatch)
    monkeypatch.setenv("PRIMARY_MODEL_PROVIDER", "openai")
    monkeypatch.setenv("PRIMARY_MODEL_DEPLOYMENT_NAME", "qwen3.8-max")
    monkeypatch.setenv("PRIMARY_MODEL_API_KEY", "thk_fake_key")
    monkeypatch.setenv("PRIMARY_MODEL_ENDPOINT", "https://tokenharbor.ai/v1")

    service = LiteLLMService()

    assert "primary_override" in service.available_models
    config = service.available_models["primary_override"]
    # openai/ prefix required: litellm can't infer the provider for a custom
    # gateway serving a model id it doesn't recognize, api_base alone isn't
    # enough of a hint (confirmed live against TokenHarbor -- unprefixed
    # raised "LLM Provider NOT provided").
    assert config["model"] == "openai/qwen3.8-max"
    assert config["api_base"] == "https://tokenharbor.ai/v1"
    assert config["api_key"] == "thk_fake_key"
    assert service.default_model == "primary_override"
    assert service.get_model_for_tier("fast") == "primary_override"


def test_primary_override_wins_over_azure_without_deleting_azure_config(monkeypatch):
    """Setting the override doesn't require removing Azure creds -- Azure
    stays registered (available for BYOK/manual selection), it's just no
    longer the *default*."""
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "fake-azure-key")
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.openai.azure.com")
    monkeypatch.setenv("PRIMARY_MODEL_PROVIDER", "openai")
    monkeypatch.setenv("PRIMARY_MODEL_DEPLOYMENT_NAME", "qwen3.8-max")
    monkeypatch.setenv("PRIMARY_MODEL_API_KEY", "thk_fake_key")
    monkeypatch.setenv("PRIMARY_MODEL_ENDPOINT", "https://tokenharbor.ai/v1")

    service = LiteLLMService()

    assert service.default_model == "primary_override"
    assert "azure_gpt41_mini" in service.available_models  # still registered, just not default


def test_no_primary_override_falls_back_to_existing_azure_openai_chain(monkeypatch):
    """Without PRIMARY_MODEL_PROVIDER set, behavior is unchanged from before
    this override existed."""
    _clear_cloud_env(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "fake-openai-key")

    service = LiteLLMService()

    assert "primary_override" not in service.available_models
    assert service.default_model == "openai_gpt4o_mini"


def test_primary_override_incomplete_config_does_not_register(monkeypatch):
    """Provider set but no deployment/key -- must not silently register a
    broken entry or crash __init__."""
    _clear_cloud_env(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "fake-openai-key")
    monkeypatch.setenv("PRIMARY_MODEL_PROVIDER", "openai")
    # PRIMARY_MODEL_DEPLOYMENT_NAME / PRIMARY_MODEL_API_KEY intentionally unset.

    service = LiteLLMService()

    assert "primary_override" not in service.available_models
    assert service.default_model == "openai_gpt4o_mini"


def test_primary_override_azure_provider_requires_endpoint(monkeypatch):
    _clear_cloud_env(monkeypatch)
    monkeypatch.setenv("PRIMARY_MODEL_PROVIDER", "azure")
    monkeypatch.setenv("PRIMARY_MODEL_DEPLOYMENT_NAME", "some-deployment")
    monkeypatch.setenv("PRIMARY_MODEL_API_KEY", "fake-key")
    # No PRIMARY_MODEL_ENDPOINT and no AZURE_OPENAI_ENDPOINT fallback either.

    service = LiteLLMService()

    assert "primary_override" not in service.available_models


def test_primary_override_custom_endpoint_never_reuses_real_provider_key(monkeypatch):
    """Bug found while wiring TokenHarbor: PRIMARY_MODEL_ENDPOINT set (custom
    gateway) but PRIMARY_MODEL_API_KEY left blank used to silently fall back
    to the raw OPENAI_API_KEY -- sending a real OpenAI credential to a
    third-party endpoint instead of just staying inactive. A gateway key is
    never interchangeable with the provider's own key."""
    _clear_cloud_env(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-real-openai-key-do-not-leak")
    monkeypatch.setenv("PRIMARY_MODEL_PROVIDER", "openai")
    monkeypatch.setenv("PRIMARY_MODEL_ENDPOINT", "https://tokenharbor.ai/v1")
    monkeypatch.setenv("PRIMARY_MODEL_DEPLOYMENT_NAME", "deepseek-v4-flash")
    # PRIMARY_MODEL_API_KEY intentionally left unset.

    service = LiteLLMService()

    assert "primary_override" not in service.available_models
    # Falls through to the real OpenAI fallback instead -- using OPENAI_API_KEY
    # against OpenAI's own endpoint is fine; that's a different, correct path.
    assert service.default_model == "openai_gpt4o_mini"


def test_reasoning_override_custom_endpoint_never_reuses_real_provider_key(monkeypatch):
    """Same bug, same fix, on the pre-existing reasoning-tier override."""
    _clear_cloud_env(monkeypatch)
    monkeypatch.delenv("REASONING_MODEL_PROVIDER", raising=False)
    monkeypatch.delenv("REASONING_MODEL_DEPLOYMENT_NAME", raising=False)
    monkeypatch.delenv("REASONING_MODEL_API_KEY", raising=False)
    monkeypatch.delenv("REASONING_MODEL_ENDPOINT", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-real-openai-key-do-not-leak")
    monkeypatch.setenv("REASONING_MODEL_PROVIDER", "openai")
    monkeypatch.setenv("REASONING_MODEL_ENDPOINT", "https://tokenharbor.ai/v1")
    monkeypatch.setenv("REASONING_MODEL_DEPLOYMENT_NAME", "glm-5.3-flash")
    # REASONING_MODEL_API_KEY intentionally left unset.

    service = LiteLLMService()

    assert "platform_reasoning" not in service.available_models


def test_primary_override_custom_endpoint_with_explicit_key_works(monkeypatch):
    """Control case: providing the explicit key alongside the custom endpoint
    is the correct, intended way to use a gateway like TokenHarbor."""
    _clear_cloud_env(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-real-openai-key-do-not-leak")
    monkeypatch.setenv("PRIMARY_MODEL_PROVIDER", "openai")
    monkeypatch.setenv("PRIMARY_MODEL_ENDPOINT", "https://tokenharbor.ai/v1")
    monkeypatch.setenv("PRIMARY_MODEL_DEPLOYMENT_NAME", "deepseek-v4-flash")
    monkeypatch.setenv("PRIMARY_MODEL_API_KEY", "thk_real_gateway_key")

    service = LiteLLMService()

    config = service.available_models["primary_override"]
    assert config["api_key"] == "thk_real_gateway_key"
    assert config["api_base"] == "https://tokenharbor.ai/v1"
    assert config["model"] == "openai/deepseek-v4-flash"


def test_reasoning_override_custom_endpoint_gets_openai_prefix(monkeypatch):
    """Same litellm provider-inference fix, on the reasoning-tier override."""
    _clear_cloud_env(monkeypatch)
    monkeypatch.delenv("REASONING_MODEL_PROVIDER", raising=False)
    monkeypatch.delenv("REASONING_MODEL_DEPLOYMENT_NAME", raising=False)
    monkeypatch.delenv("REASONING_MODEL_API_KEY", raising=False)
    monkeypatch.delenv("REASONING_MODEL_ENDPOINT", raising=False)
    monkeypatch.setenv("REASONING_MODEL_PROVIDER", "openai")
    monkeypatch.setenv("REASONING_MODEL_ENDPOINT", "https://tokenharbor.ai/v1")
    monkeypatch.setenv("REASONING_MODEL_DEPLOYMENT_NAME", "glm-5.3-flash")
    monkeypatch.setenv("REASONING_MODEL_API_KEY", "thk_real_gateway_key")

    service = LiteLLMService()

    config = service.available_models["platform_reasoning"]
    assert config["model"] == "openai/glm-5.3-flash"


def test_primary_override_does_not_double_prefix_already_prefixed_model(monkeypatch):
    _clear_cloud_env(monkeypatch)
    monkeypatch.setenv("PRIMARY_MODEL_PROVIDER", "openai")
    monkeypatch.setenv("PRIMARY_MODEL_ENDPOINT", "https://tokenharbor.ai/v1")
    monkeypatch.setenv("PRIMARY_MODEL_DEPLOYMENT_NAME", "openai/deepseek-v4-flash")
    monkeypatch.setenv("PRIMARY_MODEL_API_KEY", "thk_real_gateway_key")

    service = LiteLLMService()

    assert service.available_models["primary_override"]["model"] == "openai/deepseek-v4-flash"
    assert service.default_model == "primary_override"


def test_primary_override_display_uses_real_brand_not_routing_provider(monkeypatch):
    """Regression: a user reported the model picker showing "Primary (Openai)"
    with a generic OpenAI icon for a TokenHarbor-routed DeepSeek model. The
    'provider' field doubles as litellm's routing hint (always 'openai' for
    any OpenAI-compatible gateway) and the frontend's logo/brand lookup key --
    those are two different things once you're behind a generic gateway, so
    the display fields must be derived from the deployment id instead of the
    routing mechanism."""
    _clear_cloud_env(monkeypatch)
    monkeypatch.setenv("PRIMARY_MODEL_PROVIDER", "openai")
    monkeypatch.setenv("PRIMARY_MODEL_DEPLOYMENT_NAME", "deepseek-v4-flash")
    monkeypatch.setenv("PRIMARY_MODEL_API_KEY", "thk_fake_key")
    monkeypatch.setenv("PRIMARY_MODEL_ENDPOINT", "https://tokenharbor.ai/v1")

    service = LiteLLMService()

    config = service.available_models["primary_override"]
    assert config["provider"] == "deepseek"
    assert config["name"] == "Primary — DeepSeek V4 Flash"
    # Routing must be unaffected by the display-provider change: still an
    # OpenAI-compatible call against the custom gateway.
    assert config["model"] == "openai/deepseek-v4-flash"
    assert config["api_base"] == "https://tokenharbor.ai/v1"


def test_reasoning_override_display_uses_real_brand_not_routing_provider(monkeypatch):
    monkeypatch.delenv("REASONING_MODEL_PROVIDER", raising=False)
    monkeypatch.delenv("REASONING_MODEL_DEPLOYMENT_NAME", raising=False)
    monkeypatch.delenv("REASONING_MODEL_API_KEY", raising=False)
    monkeypatch.delenv("REASONING_MODEL_ENDPOINT", raising=False)
    monkeypatch.setenv("REASONING_MODEL_PROVIDER", "openai")
    monkeypatch.setenv("REASONING_MODEL_DEPLOYMENT_NAME", "glm-5.3-flash")
    monkeypatch.setenv("REASONING_MODEL_API_KEY", "thk_fake_key")
    monkeypatch.setenv("REASONING_MODEL_ENDPOINT", "https://tokenharbor.ai/v1")

    service = LiteLLMService()

    config = service.available_models["platform_reasoning"]
    assert config["provider"] == "zai"
    assert config["name"] == "Reasoning — GLM 5.3 Flash"
    assert config["model"] == "openai/glm-5.3-flash"


def test_reasoning_override_display_survives_the_picker_dedup(monkeypatch):
    """Regression: get_available_models() (what the frontend model picker
    actually renders) dedupes platform_reasoning away as a duplicate of
    azure_reasoning (same underlying model/api_base, azure_reasoning
    registered first) -- so azure_reasoning's own _MODEL_META entry is what
    the picker shows, not platform_reasoning's. That entry used to hardcode
    display_name="Reasoning", silently overwriting the dynamic brand-derived
    name from the fix above. A live user reported still seeing the wrong
    label/logo for the GLM reasoning model even after that name was fixed at
    the source -- this is why: the fix never reached the actual picker
    output. Confirmed here via get_available_models() itself, not the raw
    available_models dict, since that's the layer that was still broken."""
    monkeypatch.delenv("REASONING_MODEL_PROVIDER", raising=False)
    monkeypatch.delenv("REASONING_MODEL_DEPLOYMENT_NAME", raising=False)
    monkeypatch.delenv("REASONING_MODEL_API_KEY", raising=False)
    monkeypatch.delenv("REASONING_MODEL_ENDPOINT", raising=False)
    monkeypatch.setenv("REASONING_MODEL_PROVIDER", "openai")
    monkeypatch.setenv("REASONING_MODEL_DEPLOYMENT_NAME", "glm-5.3-flash")
    monkeypatch.setenv("REASONING_MODEL_API_KEY", "thk_fake_key")
    monkeypatch.setenv("REASONING_MODEL_ENDPOINT", "https://tokenharbor.ai/v1")

    service = LiteLLMService()
    picker_models = service.get_available_models()["models"]

    ids = [m["id"] for m in picker_models]
    assert "platform_reasoning" not in ids, "should be deduped away as a duplicate endpoint"
    entry = next(m for m in picker_models if m["id"] == "azure_reasoning")
    assert entry["name"] == "Reasoning — GLM 5.3 Flash"
    assert entry["provider"] == "zai"


def test_direct_provider_without_custom_endpoint_keeps_routing_provider_as_display(monkeypatch):
    """When PRIMARY_MODEL_PROVIDER talks to a provider directly (no custom
    gateway endpoint), the routing provider already IS the correct display
    brand -- e.g. PRIMARY_MODEL_PROVIDER=anthropic against real
    api.anthropic.com. Only the custom-endpoint (gateway) case needs the
    deployment-id-derived override."""
    _clear_cloud_env(monkeypatch)
    monkeypatch.setenv("PRIMARY_MODEL_PROVIDER", "anthropic")
    monkeypatch.setenv("PRIMARY_MODEL_DEPLOYMENT_NAME", "claude-sonnet-5")
    monkeypatch.setenv("PRIMARY_MODEL_API_KEY", "sk-ant-fake")
    monkeypatch.delenv("PRIMARY_MODEL_ENDPOINT", raising=False)

    service = LiteLLMService()

    config = service.available_models["primary_override"]
    assert config["provider"] == "anthropic"
    assert config["name"] == "Primary (Anthropic)"
