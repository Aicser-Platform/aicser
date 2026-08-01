import os
import pytest

if os.getenv("AISER_EDITION", "community").lower() in ("enterprise", "ee") or os.getenv("AISER_EDITION_LICENSE_KEY"):
    pytest.skip("CE-only text-to-sql providers", allow_module_level=True)

from src.modules.ai.providers import provider_for_model, litellm_model_string, PROVIDER_MODELS


def test_provider_for_model_by_catalog():
    assert provider_for_model("gpt-4o") == "openai"
    assert provider_for_model("claude-3-5-sonnet-latest") == "anthropic"
    assert provider_for_model("gemini-2.0-flash") == "google"


def test_provider_for_model_by_prefix():
    assert provider_for_model("azure/gpt-4o") == "azure_openai"
    assert provider_for_model("ollama/llama3.1") == "ollama"
    assert provider_for_model("gemini/gemini-1.5-pro") == "google"


def test_provider_for_bare_ollama_model_from_saved_config():
    keys = {"ollama": {"endpoint": "http://ollama:11434", "model": "llama3.2:1b"}}
    assert provider_for_model("llama3.2:1b", keys) == "ollama"
    assert provider_for_model("ollama/llama3.2:1b", keys) == "ollama"


def test_provider_for_model_unknown_defaults_by_name():
    assert provider_for_model("claude-4-something") == "anthropic"
    assert provider_for_model("gpt-9") == "openai"
    assert provider_for_model("totally-unknown") == "openai"


def test_litellm_model_string():
    assert litellm_model_string("openai", "gpt-4o") == "gpt-4o"
    assert litellm_model_string("anthropic", "claude-3-5-sonnet-latest") == "anthropic/claude-3-5-sonnet-latest"
    assert litellm_model_string("google", "gemini-2.0-flash") == "gemini/gemini-2.0-flash"
    assert litellm_model_string("azure_openai", "azure/gpt-4o") == "azure/gpt-4o"
    assert litellm_model_string("ollama", "ollama/llama3.1") == "ollama/llama3.1"
    assert litellm_model_string("ollama", "llama3.2:1b") == "ollama/llama3.2:1b"


def test_provider_models_shape():
    assert "openai" in PROVIDER_MODELS
    assert all("id" in m for m in PROVIDER_MODELS["openai"])
