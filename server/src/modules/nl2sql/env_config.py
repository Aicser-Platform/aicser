"""Shared operator env reads for CE NL2SQL and embeddings (aligned with config.py / EE)."""

from __future__ import annotations

import os
from typing import Optional, Tuple


def azure_deployment_name() -> str:
    return (
        os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "").strip()
        or os.getenv("AZURE_OPENAI_DEPLOYMENT", "").strip()
        or "gpt-4.1-mini"
    )


def azure_api_version() -> str:
    return os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-15-preview").strip()


def openai_chat_model() -> str:
    return (
        os.getenv("OPENAI_MODEL_ID", "").strip()
        or os.getenv("OPENAI_MODEL", "").strip()
        or "gpt-4o-mini"
    )


def azure_openai_credentials() -> Tuple[Optional[str], Optional[str], str]:
    """Return (api_key, endpoint, deployment) when Azure OpenAI is configured."""
    key = os.getenv("AZURE_OPENAI_API_KEY", "").strip() or None
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "").strip() or None
    if not key or not endpoint:
        return None, None, azure_deployment_name()
    return key, endpoint, azure_deployment_name()


def azure_gpt41_credentials() -> Tuple[Optional[str], Optional[str], str]:
    """Optional secondary Azure deployment (matches EE litellm_service)."""
    key = os.getenv("AZURE_OPENAI_GPT41_API_KEY", "").strip() or None
    endpoint = os.getenv("AZURE_OPENAI_GPT41_ENDPOINT", "").strip() or None
    deployment = (
        os.getenv("AZURE_OPENAI_GPT41_DEPLOYMENT_NAME", "").strip()
        or "gpt-4.1-mini"
    )
    if not key or not endpoint:
        return None, None, deployment
    return key, endpoint, deployment


def embedding_api_config() -> dict:
    """
    Resolve embedding provider settings from operator env.
    Mirrors ee/modules/ai/utils/embedding_service.py with AISER_* aliases.
    """
    azure_key = os.getenv("AZURE_OPENAI_API_KEY", "").strip()
    azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "").strip()
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()

    model = (
        os.getenv("AISER_EMBEDDING_MODEL", "").strip()
        or os.getenv("EMBEDDING_MODEL", "").strip()
        or "text-embedding-3-small"
    )
    api_key = (
        os.getenv("AISER_EMBEDDING_API_KEY", "").strip()
        or os.getenv("EMBEDDING_API_KEY", "").strip()
        or azure_key
        or openai_key
    )
    api_base = (
        os.getenv("AISER_EMBEDDING_API_BASE", "").strip()
        or os.getenv("EMBEDDING_API_BASE", "").strip()
        or azure_endpoint
        or None
    )
    api_version = (
        os.getenv("EMBEDDING_API_VERSION", "").strip()
        or os.getenv("AZURE_OPENAI_API_VERSION", "").strip()
        or None
    )

    embed_deployment = os.getenv("AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME", "").strip()
    if embed_deployment:
        model = f"azure/{embed_deployment}"
    elif api_base and azure_key and not model.startswith("azure/"):
        # Azure OpenAI: route embeddings through azure/{deployment} when endpoint is Azure
        if "openai.azure.com" in api_base.lower() or os.getenv("AZURE_OPENAI_ENDPOINT", "").strip():
            model = f"azure/{model}"

    return {
        "model": model,
        "api_key": api_key or None,
        "api_base": api_base or None,
        "api_version": api_version,
    }
