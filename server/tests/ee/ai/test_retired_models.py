"""Retired models stay out of the platform, whatever an old environment file says."""
import pytest

from src.modules.ai.services import litellm_service as L


@pytest.mark.parametrize("model", ["gpt-4.1-mini", "gpt-4o-mini", "azure/gpt-4.1-mini", "GPT-4O-MINI", "gpt-4o"])
def test_retired(model):
    assert L.is_retired_model(model)


@pytest.mark.parametrize("model", ["gpt-6-luna", "azure/gpt-5.6-luna", "", None])
def test_current(model):
    assert not L.is_retired_model(model)


def _service(monkeypatch, **env):
    for key in ("AZURE_OPENAI_GPT41_API_KEY", "AZURE_OPENAI_GPT41_ENDPOINT", "AZURE_OPENAI_GPT41_DEPLOYMENT_NAME",
                "OPENAI_API_KEY", "OPENAI_MODEL_ID"):
        monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    return L.LiteLLMService()


def test_an_old_azure_deployment_is_not_offered(monkeypatch):
    service = _service(monkeypatch, AZURE_OPENAI_GPT41_API_KEY="k", AZURE_OPENAI_GPT41_ENDPOINT="https://x.openai.azure.com",
                       AZURE_OPENAI_GPT41_DEPLOYMENT_NAME="gpt-4.1-mini")
    assert "azure_gpt41_mini" not in service.available_models


def test_a_current_azure_deployment_is_named_for_what_it_is(monkeypatch):
    service = _service(monkeypatch, AZURE_OPENAI_GPT41_API_KEY="k", AZURE_OPENAI_GPT41_ENDPOINT="https://x.openai.azure.com",
                       AZURE_OPENAI_GPT41_DEPLOYMENT_NAME="gpt-5.6-luna")
    assert "4.1" not in service.available_models["azure_gpt41_mini"]["name"]


def test_openai_moves_off_a_retired_model(monkeypatch):
    service = _service(monkeypatch, OPENAI_API_KEY="k", OPENAI_MODEL_ID="gpt-4o-mini")
    entry = service.available_models["openai_gpt4o_mini"]
    assert entry["model"] == "gpt-6-luna" and "4o" not in entry["name"]
