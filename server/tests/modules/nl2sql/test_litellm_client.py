import os
from unittest.mock import AsyncMock, patch

import pytest

from src.modules.nl2sql.litellm_client import CELiteLLMClient


@pytest.fixture
def clean_env(monkeypatch):
    for key in (
        "AZURE_OPENAI_API_KEY",
        "AZURE_OPENAI_ENDPOINT",
        "AZURE_OPENAI_DEPLOYMENT_NAME",
        "OPENAI_API_KEY",
        "OLLAMA_BASE_URL",
        "OLLAMA_MODEL",
        "AISER_CUSTOM_MODELS",
    ):
        monkeypatch.delenv(key, raising=False)


def test_openai_not_registered_when_azure_configured(clean_env, monkeypatch):
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "azure-key")
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.openai.azure.com")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-4.1-mini")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-stale-invalid")

    client = CELiteLLMClient()
    assert "azure_default" in client.available_models
    assert "openai_default" not in client.available_models
    assert client.available_models["azure_default"]["available"] is False
    assert client.available_models["azure_default"]["is_operator"] is True


@pytest.fixture
def openai_only_client(clean_env, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    with patch(
        "src.modules.nl2sql.litellm_client.azure_openai_credentials",
        return_value=(None, None, "gpt-4.1-mini"),
    ), patch(
        "src.modules.nl2sql.litellm_client.azure_gpt41_credentials",
        return_value=(None, None, "gpt-4.1-mini"),
    ):
        yield CELiteLLMClient()


def test_operator_models_start_unavailable(openai_only_client):
    client = openai_only_client
    assert client.available_models["openai_default"]["available"] is False


@pytest.mark.asyncio
async def test_verify_model_updates_availability(openai_only_client):
    client = openai_only_client
    with patch("litellm.acompletion", new=AsyncMock(return_value={"choices": [{"message": {"content": "ok"}}]})):
        result = await client.verify_model("openai_default")

    assert result["available"] is True
    assert client.available_models["openai_default"]["available"] is True


@pytest.mark.asyncio
async def test_resolve_skips_unverified_operator(openai_only_client):
    client = openai_only_client
    with patch.object(client, "refresh_operator_availability", new=AsyncMock()):
        picked = await client.resolve_model_id(None, None)

    assert picked is None


@pytest.mark.asyncio
async def test_resolve_picks_verified_operator(openai_only_client):
    client = openai_only_client
    client.available_models["openai_default"]["available"] = True

    with patch.object(client, "refresh_operator_availability", new=AsyncMock()):
        picked = await client.resolve_model_id(None, None)

    assert picked == "openai_default"
