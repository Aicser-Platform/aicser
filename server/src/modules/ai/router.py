"""Community Edition AI metadata routes.

CE does not ship Aicser-managed AI orchestration. These endpoints expose model
availability for bring-your-own-key providers configured in Settings or env.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_async_session
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer, get_current_user
from src.modules.ai.providers import (
    PROVIDER_MODELS,
    ENV_KEYS,
    has_env_provider as _has_env_provider,
    provider_for_model,
    saved_provider_keys as _saved_provider_keys,
)
from src.modules.ai.services.text_to_sql_service import (
    TextToSqlService,
    NoProviderKeyError,
    DataSourceNotFoundError,
)

logger = logging.getLogger(__name__)

router = APIRouter()


async def _optional_user_id(request: Request) -> Optional[str]:
    try:
        payload = await get_current_user(request)
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    user_id = payload.get("id") or payload.get("user_id") or payload.get("sub")
    return str(user_id) if user_id else None


def _model_with_status(
    provider: str,
    model: dict[str, Any],
    *,
    available: bool,
    source: str,
) -> dict[str, Any]:
    configured_by = source if available else None
    description = (
        f"Configured via {configured_by}."
        if configured_by
        else "Configure a provider API key in Settings -> API Keys to enable this model."
    )
    return {
        **model,
        "provider": provider,
        "available": available,
        "configured_by": configured_by,
        "description": description,
        "category": model.get("category") or ("Local" if model.get("is_local") else "Standard"),
    }


@router.get("/models")
async def list_models(request: Request):
    user_id = await _optional_user_id(request)
    saved_keys = await _saved_provider_keys(user_id)
    models: list[dict[str, Any]] = []

    for provider, provider_models in PROVIDER_MODELS.items():
        saved_config = saved_keys.get(provider) or {}
        has_saved_key = bool(saved_config.get("api_key")) or provider == "ollama" and bool(saved_config.get("endpoint"))
        has_env_key = _has_env_provider(provider)
        available = has_saved_key or has_env_key
        source = "user_key" if has_saved_key else "environment" if has_env_key else ""

        for model in provider_models:
            models.append(_model_with_status(provider, model, available=available, source=source))

        custom_model = (saved_config.get("model") or "").strip()
        if custom_model and all(m.get("id") != custom_model for m in provider_models):
            models.append(
                _model_with_status(
                    provider,
                    {
                        "id": custom_model,
                        "name": custom_model,
                        "tier": "custom",
                        "cost_per_1k_tokens": 0,
                        "is_local": provider == "ollama",
                    },
                    available=available,
                    source=source,
                )
            )

    default_model = os.getenv("DEFAULT_AI_MODEL") or "auto"
    return {
        "success": True,
        "edition": "community",
        "managed_ai": False,
        "requires_provider_key": True,
        "default_model": default_model,
        "models": models,
    }


@router.get("/model-status")
async def model_status(model_id: str, request: Request):
    user_id = await _optional_user_id(request)
    saved_keys = await _saved_provider_keys(user_id)
    provider = model_id.split("/", 1)[0] if "/" in model_id else ""
    if provider == "azure":
        provider = "azure_openai"
    if provider not in PROVIDER_MODELS:
        provider = next(
            (
                candidate
                for candidate, provider_models in PROVIDER_MODELS.items()
                if any(item.get("id") == model_id for item in provider_models)
            ),
            "openai",
        )
    available = bool(saved_keys.get(provider, {}).get("api_key")) or _has_env_provider(provider)
    return {
        "success": True,
        "available": available,
        "managed_ai": False,
        "message": (
            "Model can use the configured provider key."
            if available
            else "Configure a provider API key in Settings -> API Keys."
        ),
    }


def _user_id_from_token(token: Union[str, dict]) -> str:
    if isinstance(token, dict):
        return str(token.get("id") or token.get("sub") or token.get("user_id") or "")
    return str(token or "")


@router.post("/text-to-sql")
async def generate_text_to_sql(
    payload: dict,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
):
    """CE natural-language → SQL using the user's own provider key (BYOK)."""
    user_id = _user_id_from_token(current_token)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    question = (payload or {}).get("question")
    data_source_id = (payload or {}).get("data_source_id")
    model = (payload or {}).get("model")

    service = TextToSqlService()
    try:
        return await service.generate(
            user_id=user_id, question=question, data_source_id=data_source_id, model=model
        )
    except NoProviderKeyError as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "no_provider_key",
                "provider": err.provider,
                "message": "No AI provider key configured. Add one in Settings → API Keys.",
            },
        )
    except DataSourceNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Data source not found")
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err))
    except Exception as err:  # provider / litellm failure
        logger.warning("text-to-sql generation failed: %s", err)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "llm_error", "message": "AI provider request failed."},
        )
