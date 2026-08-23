"""_infer_tier's o-series check required a leading hyphen ("-o3") that never
matches OpenAI's real naming (bare "o3", "o3-mini", or provider-prefixed
"azure/o3") - the function's own docstring names bare "o3" as the motivating
example. Also covers the reasoning-tier platform slot now supporting any
provider, not just Azure (previously it hardcoded `model: f'azure/{deployment}'`
and required an Azure endpoint even when the operator wanted OpenAI/
Anthropic/Google as their reasoning deployment).
"""

import pytest

from ee.modules.ai.services.user_byok_models import _infer_tier
from ee.modules.ai.services.litellm_service import LiteLLMService


@pytest.mark.parametrize(
    "model_id,expected",
    [
        ("o3", "reasoning"),
        ("o3-mini", "reasoning"),
        ("o1", "reasoning"),
        ("o1-preview", "reasoning"),
        ("azure/o3", "reasoning"),
        ("gpt-4o-mini", "fast"),
        ("gpt-4.1-mini", "fast"),
        ("gpt-4o", "standard"),
        ("claude-opus-4-8", "reasoning"),
        ("claude-haiku-4-5", "fast"),
        ("gpt-5.6-luna", "fast"),
        ("gpt-5.6-sol", "reasoning"),
        ("gpt-5", "reasoning"),
    ],
)
def test_infer_tier(model_id, expected):
    assert _infer_tier(model_id) == expected


def test_reasoning_tier_supports_anthropic_not_just_azure(monkeypatch):
    for var in ("AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT", "OPENAI_API_KEY"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("REASONING_MODEL_PROVIDER", "anthropic")
    monkeypatch.setenv("REASONING_MODEL_DEPLOYMENT_NAME", "claude-opus-5")
    monkeypatch.setenv("REASONING_MODEL_API_KEY", "fake-anthropic-key")

    service = LiteLLMService()

    assert "platform_reasoning" in service.available_models
    config = service.available_models["platform_reasoning"]
    assert config["provider"] == "anthropic"
    assert config["model"] == "anthropic/claude-opus-5"
    assert service.get_model_for_tier("reasoning") == "platform_reasoning"


def test_reasoning_tier_still_supports_azure(monkeypatch):
    monkeypatch.setenv("REASONING_MODEL_PROVIDER", "azure")
    monkeypatch.setenv("REASONING_MODEL_DEPLOYMENT_NAME", "gpt-5-deployment")
    monkeypatch.setenv("REASONING_MODEL_API_KEY", "fake-azure-key")
    monkeypatch.setenv("REASONING_MODEL_ENDPOINT", "https://example.openai.azure.com")

    service = LiteLLMService()

    config = service.available_models["platform_reasoning"]
    assert config["provider"] == "azure"
    assert config["model"] == "azure/gpt-5-deployment"


def test_platform_default_model_gets_real_tier_not_hardcoded_fast(monkeypatch):
    """An operator pointing the plain default at a strong model (not a mini)
    should get correct reasoning-tier routing automatically."""
    for var in ("AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "fake-openai-key")
    monkeypatch.setenv("OPENAI_MODEL_ID", "o3-mini")

    service = LiteLLMService()

    assert service.available_models["openai_gpt4o_mini"]["tier"] == "reasoning"
    assert service.get_model_for_tier("reasoning") == "openai_gpt4o_mini"
