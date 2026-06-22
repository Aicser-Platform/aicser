"""CE LiteLLM client — env models + BYOK, no EE imports."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any, Dict, List, Optional, Tuple

from src.modules.nl2sql.byok import BYOK_INTERNAL_ID, load_user_byok_models
from src.modules.nl2sql.env_config import (
    azure_api_version,
    azure_gpt41_credentials,
    azure_openai_credentials,
    openai_chat_model,
)
from src.modules.nl2sql.error_sanitize import sanitize_client_error
from src.modules.user.user_setting_repository import UserSettingRepository

logger = logging.getLogger(__name__)

_VERIFICATION_TTL_SEC = 60


class CELiteLLMClient:
    def __init__(self) -> None:
        self.available_models: Dict[str, Dict[str, Any]] = {}
        self.default_model: str = ""
        self._verification_cache: Dict[str, Tuple[float, bool]] = {}
        self._register_env_models()

    @staticmethod
    def _operator_entry(**fields: Any) -> Dict[str, Any]:
        """Operator env models start unavailable until a connection probe succeeds."""
        return {**fields, "is_operator": True, "available": False}

    def _register_env_models(self) -> None:
        # Azure primary (same env as deploy/.env and EE litellm_service)
        azure_key, azure_endpoint, azure_deployment = azure_openai_credentials()
        if azure_key and azure_endpoint:
            self.available_models["azure_default"] = self._operator_entry(
                id="azure_default",
                name=f"Azure OpenAI ({azure_deployment})",
                model=f"azure/{azure_deployment}",
                api_key=azure_key,
                api_base=azure_endpoint.rstrip("/") + "/",
                api_version=azure_api_version(),
                provider="azure",
                tier="fast",
                max_tokens=8000,
                temperature=0.1,
                cost_per_1k_tokens=0.0,
            )
            self.default_model = "azure_default"

        gpt41_key, gpt41_endpoint, gpt41_deployment = azure_gpt41_credentials()
        if gpt41_key and gpt41_endpoint:
            self.available_models["azure_gpt41"] = self._operator_entry(
                id="azure_gpt41",
                name=f"Azure GPT-4.1 ({gpt41_deployment})",
                model=f"azure/{gpt41_deployment}",
                api_key=gpt41_key,
                api_base=gpt41_endpoint.rstrip("/") + "/",
                api_version=os.getenv("AZURE_OPENAI_GPT41_API_VERSION", azure_api_version()).strip(),
                provider="azure",
                tier="fast",
                max_tokens=8000,
                temperature=0.1,
                cost_per_1k_tokens=0.0,
            )
            if not self.default_model:
                self.default_model = "azure_gpt41"

        ollama_url = os.getenv("OLLAMA_BASE_URL", "").strip()
        ollama_model = os.getenv("OLLAMA_MODEL", "").strip()
        if ollama_url and ollama_model:
            safe = ollama_model.replace(":", "_").replace("/", "_")
            mid = f"ollama_{safe}"
            self.available_models[mid] = self._operator_entry(
                id=mid,
                name=f"Ollama · {ollama_model}",
                model=f"ollama/{ollama_model}",
                api_base=ollama_url,
                provider="ollama",
                tier="fast",
                max_tokens=8192,
                temperature=0.1,
                cost_per_1k_tokens=0.0,
                is_local=True,
            )
            if not self.default_model:
                self.default_model = mid

        # OpenAI fallback — skip when Azure operator env is configured (avoids stale invalid keys)
        openai_key = os.getenv("OPENAI_API_KEY", "").strip()
        has_azure_operator = any(
            cfg.get("is_operator") and cfg.get("provider") == "azure"
            for cfg in self.available_models.values()
        )
        if openai_key and not has_azure_operator:
            model = openai_chat_model()
            self.available_models["openai_default"] = self._operator_entry(
                id="openai_default",
                name=f"OpenAI {model}",
                model=model,
                api_key=openai_key,
                provider="openai",
                tier="fast",
                max_tokens=8000,
                temperature=0.1,
                cost_per_1k_tokens=0.0,
            )
            if not self.default_model:
                self.default_model = "openai_default"

        custom_raw = os.getenv("AISER_CUSTOM_MODELS", "").strip()
        if custom_raw:
            try:
                items = json.loads(custom_raw)
                if isinstance(items, list):
                    for i, item in enumerate(items):
                        if not isinstance(item, dict) or not item.get("model"):
                            continue
                        mid = str(item.get("id") or f"custom_{i}")
                        self.available_models[mid] = self._operator_entry(
                            id=mid,
                            name=item.get("name") or mid,
                            model=item["model"],
                            api_key=item.get("api_key"),
                            api_base=item.get("api_base"),
                            provider=item.get("provider", "openai"),
                            tier=item.get("tier", "fast"),
                            max_tokens=item.get("max_tokens", 8000),
                            temperature=item.get("temperature", 0.1),
                            cost_per_1k_tokens=0.0,
                            is_local=item.get("provider") == "ollama",
                        )
            except Exception as exc:
                logger.warning("Failed to parse AISER_CUSTOM_MODELS: %s", exc)

    async def hydrate_user(self, user_id: Optional[str]) -> None:
        for iid in BYOK_INTERNAL_ID.values():
            self.available_models.pop(iid, None)
        byok = await load_user_byok_models(user_id)
        self.available_models.update(byok)
        if byok and not self.default_model:
            for pref in ("byok_google", "byok_openai", "byok_anthropic", "byok_azure_openai"):
                if pref in byok:
                    self.default_model = pref
                    break

    def _is_usable(self, model_id: str) -> bool:
        cfg = self.available_models.get(model_id)
        if not cfg:
            return False
        return cfg.get("available") is not False

    def _litellm_test_kwargs(self, cfg: Dict[str, Any]) -> Dict[str, Any]:
        kwargs: Dict[str, Any] = {
            "model": cfg["model"],
            "messages": [{"role": "user", "content": "ping"}],
            "temperature": 0,
            "max_tokens": 5,
        }
        model_name = str(cfg.get("model") or "")
        if cfg.get("provider") == "azure" or model_name.startswith("azure/"):
            kwargs["max_completion_tokens"] = 5
            kwargs.pop("max_tokens", None)
        if cfg.get("api_key"):
            kwargs["api_key"] = cfg["api_key"]
        if cfg.get("api_base"):
            kwargs["api_base"] = cfg["api_base"]
        if cfg.get("api_version"):
            kwargs["api_version"] = cfg["api_version"]
        return kwargs

    async def verify_model(self, model_id: str, *, force: bool = False) -> Dict[str, Any]:
        cfg = self.available_models.get(model_id)
        if not cfg:
            return {"success": False, "available": False, "model_id": model_id, "error": "Model not found"}

        cached = self._verification_cache.get(model_id)
        if not force and cached and (time.time() - cached[0]) < _VERIFICATION_TTL_SEC:
            ok = cached[1]
            if cfg.get("is_operator"):
                cfg["available"] = ok
            return {"success": ok, "available": ok, "model_id": model_id, "cached": True}

        ok = False
        error: Optional[str] = None
        try:
            from litellm import acompletion

            await acompletion(**self._litellm_test_kwargs(cfg))
            ok = True
        except Exception as exc:
            error = str(exc)
            logger.info("CE model verification failed for %s: %s", model_id, exc)

        self._verification_cache[model_id] = (time.time(), ok)
        if cfg.get("is_operator"):
            cfg["available"] = ok
        return {"success": ok, "available": ok, "model_id": model_id, "error": error}

    async def refresh_operator_availability(self) -> None:
        operator_ids = [mid for mid, cfg in self.available_models.items() if cfg.get("is_operator")]
        if not operator_ids:
            return
        await asyncio.gather(*(self.verify_model(mid) for mid in operator_ids), return_exceptions=True)

    def _first_usable(self, candidates: List[str]) -> Optional[str]:
        for mid in candidates:
            if self._is_usable(mid):
                return mid
        return None

    async def resolve_model_id(self, user_id: Optional[str], requested: Optional[str] = None) -> Optional[str]:
        await self.hydrate_user(user_id)
        await self.refresh_operator_availability()

        if requested and requested not in ("auto", ""):
            if requested not in self.available_models:
                return None
            cfg = self.available_models[requested]
            if cfg.get("is_operator") and not self._is_usable(requested):
                result = await self.verify_model(requested, force=True)
                if not result.get("available"):
                    return None
            elif not self._is_usable(requested):
                return None
            return requested

        if user_id:
            repo = UserSettingRepository()
            pref = await repo.get_setting(str(user_id), "preferred_ai_model")
            if pref and pref.value:
                picked = self._first_usable([pref.value])
                if picked:
                    return picked

        for mid in ("byok_google", "byok_openai", "byok_anthropic", "byok_azure_openai"):
            if self._is_usable(mid):
                return mid

        if self.default_model:
            picked = self._first_usable([self.default_model])
            if picked:
                return picked

        for mid, cfg in self.available_models.items():
            if self._is_usable(mid):
                return mid
        return None

    def list_models(self) -> List[Dict[str, Any]]:
        return list(self.available_models.values())

    def get_model_config(self, model_id: str) -> Optional[Dict[str, Any]]:
        return self.available_models.get(model_id)

    async def generate_completion(
        self,
        *,
        system_context: str,
        prompt: str,
        user_id: Optional[str] = None,
        model_id: Optional[str] = None,
        max_tokens: int = 4000,
        temperature: float = 0.1,
    ) -> Dict[str, Any]:
        resolved = await self.resolve_model_id(user_id, model_id)
        if not resolved:
            return {
                "success": False,
                "error": (
                    "No AI model configured. Add BYOK keys in Settings → API Keys, "
                    "or set operator env in deploy/.env: AZURE_OPENAI_* (primary), "
                    "OPENAI_API_KEY (fallback), or OLLAMA_BASE_URL + OLLAMA_MODEL."
                ),
            }

        cfg = self.available_models[resolved]
        try:
            from litellm import acompletion

            kwargs: Dict[str, Any] = {
                "model": cfg["model"],
                "messages": [
                    {"role": "system", "content": system_context},
                    {"role": "user", "content": prompt},
                ],
                "max_tokens": min(max_tokens, cfg.get("max_tokens", 8000)),
                "temperature": temperature,
            }
            if cfg.get("api_key"):
                kwargs["api_key"] = cfg["api_key"]
            if cfg.get("api_base"):
                kwargs["api_base"] = cfg["api_base"]
            if cfg.get("api_version"):
                kwargs["api_version"] = cfg["api_version"]

            response = await acompletion(**kwargs)
            content = ""
            if hasattr(response, "choices") and response.choices:
                msg = response.choices[0].message
                content = getattr(msg, "content", None) or ""
            elif isinstance(response, dict):
                choices = response.get("choices") or []
                if choices:
                    content = (choices[0].get("message") or {}).get("content") or ""

            if not content:
                return {"success": False, "error": "Empty response from AI model"}

            return {"success": True, "content": content.strip(), "model_id": resolved}
        except Exception as exc:
            logger.error("CE LiteLLM completion failed: %s", exc, exc_info=True)
            return {"success": False, "error": sanitize_client_error(str(exc))}
