"""
CE embedding service abstraction.

Provides a shared interface for text embeddings used by knowledge ingestion,
NL2SQL few-shot retrieval, and RAG. EE builds may delegate to the EE shim;
CE builds use LiteLLM directly when configured.
"""

from __future__ import annotations

import logging
import os
from abc import ABC, abstractmethod
from typing import List, Optional

from src.core.edition import is_ee_enabled

logger = logging.getLogger(__name__)

QUERY_INSTRUCTION_PREFIX = "Retrieve similar NL-to-SQL examples for: "


class EmbeddingService(ABC):
    @abstractmethod
    async def embed_texts(
        self,
        texts: List[str],
        instruction_prefix: Optional[str] = None,
    ) -> List[Optional[List[float]]]:
        raise NotImplementedError

    async def embed_text(
        self,
        text: str,
        instruction_prefix: Optional[str] = None,
    ) -> Optional[List[float]]:
        if not text or not text.strip():
            return None
        results = await self.embed_texts([text], instruction_prefix=instruction_prefix)
        return results[0] if results else None


class _EEEmbeddingService(EmbeddingService):
    async def embed_texts(
        self,
        texts: List[str],
        instruction_prefix: Optional[str] = None,
    ) -> List[Optional[List[float]]]:
        from src.modules.ai.utils.embedding_service import get_embedding_batch

        return await get_embedding_batch(texts, instruction_prefix=instruction_prefix)


class _CELiteLLMEmbeddingService(EmbeddingService):
    """CE-native embeddings via LiteLLM (Azure/OpenAI-compatible)."""

    def __init__(self) -> None:
        from src.modules.nl2sql.env_config import embedding_api_config

        cfg = embedding_api_config()
        self.model = cfg["model"] or "text-embedding-3-small"
        self.api_key = cfg["api_key"]
        self.api_base = cfg["api_base"]
        self.api_version = cfg["api_version"]

    def _configured(self) -> bool:
        return bool(self.model and self.api_key)

    async def embed_texts(
        self,
        texts: List[str],
        instruction_prefix: Optional[str] = None,
    ) -> List[Optional[List[float]]]:
        if not texts:
            return []
        if not self._configured():
            logger.debug("CE embedding skipped: AISER_EMBEDDING_MODEL or API key not set")
            return [None] * len(texts)

        prefix = instruction_prefix or ""
        inputs = [f"{prefix}{t}" if prefix else t for t in texts if t]
        if not inputs:
            return [None] * len(texts)

        try:
            from litellm import aembedding

            kwargs = {
                "model": self.model,
                "input": inputs,
                "api_key": self.api_key,
            }
            if self.api_base:
                kwargs["api_base"] = self.api_base
            if self.api_version and "azure" in self.model.lower():
                kwargs["api_version"] = self.api_version

            response = await aembedding(**kwargs)
            data = getattr(response, "data", None) or (response.get("data") if isinstance(response, dict) else None)
            if not data:
                return [None] * len(texts)

            vectors: List[Optional[List[float]]] = []
            for item in data:
                emb = getattr(item, "embedding", None)
                if emb is None and isinstance(item, dict):
                    emb = item.get("embedding")
                vectors.append(list(emb) if emb else None)

            # Pad if LiteLLM dropped empty inputs
            while len(vectors) < len(texts):
                vectors.append(None)
            return vectors[: len(texts)]
        except Exception as exc:
            logger.warning("CE LiteLLM embedding failed: %s", exc)
            return [None] * len(texts)


class _NoOpEmbeddingService(EmbeddingService):
    async def embed_texts(
        self,
        texts: List[str],
        instruction_prefix: Optional[str] = None,
    ) -> List[Optional[List[float]]]:
        return [None] * len(texts)


_embedding_service: Optional[EmbeddingService] = None


def get_embedding_service() -> EmbeddingService:
    global _embedding_service
    if _embedding_service is not None:
        return _embedding_service

    if is_ee_enabled():
        try:
            from src.modules.ai.utils.embedding_service import get_embedding_batch  # noqa: F401

            _embedding_service = _EEEmbeddingService()
            return _embedding_service
        except ImportError:
            logger.warning("EE embedding service unavailable; trying CE LiteLLM")

    ce = _CELiteLLMEmbeddingService()
    if ce._configured():
        _embedding_service = ce
        return _embedding_service

    _embedding_service = _NoOpEmbeddingService()
    return _embedding_service


async def get_embedding(
    text: str,
    instruction_prefix: Optional[str] = None,
) -> Optional[List[float]]:
    """Convenience wrapper for single-text embedding."""
    return await get_embedding_service().embed_text(text, instruction_prefix=instruction_prefix)
