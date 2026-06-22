"""Tests for CE NL2SQL operator env configuration."""

import os
from unittest.mock import patch

from src.modules.nl2sql.env_config import (
    azure_deployment_name,
    azure_openai_credentials,
    embedding_api_config,
    openai_chat_model,
)
from src.modules.nl2sql.litellm_client import CELiteLLMClient


def test_azure_deployment_name_prefers_deployment_name():
    with patch.dict(os.environ, {
        "AZURE_OPENAI_DEPLOYMENT_NAME": "gpt-5-mini",
        "AZURE_OPENAI_DEPLOYMENT": "legacy-name",
    }, clear=False):
        assert azure_deployment_name() == "gpt-5-mini"


def test_openai_chat_model_prefers_model_id():
    with patch.dict(os.environ, {
        "OPENAI_MODEL_ID": "gpt-4.1-mini",
        "OPENAI_MODEL": "gpt-4o-mini",
    }, clear=False):
        assert openai_chat_model() == "gpt-4.1-mini"


def test_ce_litellm_prefers_azure_over_openai():
    env = {
        "AZURE_OPENAI_API_KEY": "azure-key",
        "AZURE_OPENAI_ENDPOINT": "https://example.openai.azure.com",
        "AZURE_OPENAI_DEPLOYMENT_NAME": "gpt-5-mini",
        "OPENAI_API_KEY": "sk-openai",
    }
    with patch.dict(os.environ, env, clear=False):
        client = CELiteLLMClient()
        assert "azure_default" in client.available_models
        assert client.default_model == "azure_default"
        assert client.available_models["azure_default"]["model"] == "azure/gpt-5-mini"


def test_embedding_uses_azure_when_configured():
    env = {
        "AZURE_OPENAI_API_KEY": "azure-key",
        "AZURE_OPENAI_ENDPOINT": "https://example.openai.azure.com",
        "OPENAI_API_KEY": "sk-openai",
    }
    with patch.dict(os.environ, env, clear=False):
        cfg = embedding_api_config()
        assert cfg["api_key"] == "azure-key"
        assert cfg["api_base"] == "https://example.openai.azure.com"
        assert cfg["model"].startswith("azure/")
