"""
CE embedding service abstraction.

Provides a shared interface for text embeddings used by knowledge ingestion
and retrieval. When Enterprise Edition is enabled, resolves to the EE embedding
service via the src.modules.ai shim.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import List, Optional

from src.core.edition import is_ee_enabled

logger = logging.getLogger(__name__)

# Instruction prefix for retrieval queries (mirrors EE embedding_service)
QUERY_INSTRUCTION_PREFIX = "Retrieve similar NL-to-SQL examples for: "


class EmbeddingService(ABC):
    """Abstract embedding service for CE/EE compatibility."""

    @abstractmethod
    async def embed_texts(
        self,
        texts: List[str],
        instruction_prefix: Optional[str] = None,
    ) -> List[Optional[List[float]]]:
        """Embed multiple texts. Returns one vector per input (None on failure)."""
        raise NotImplementedError

    async def embed_text(
        self,
        text: str,
        instruction_prefix: Optional[str] = None,
    ) -> Optional[List[float]]:
        """Embed a single text string."""
        if not text or not text.strip():
            return None
        results = await self.embed_texts([text], instruction_prefix=instruction_prefix)
        return results[0] if results else None


class _EEEmbeddingService(EmbeddingService):
    """Embedding service backed by the EE src.modules.ai shim."""

    async def embed_texts(
        self,
        texts: List[str],
        instruction_prefix: Optional[str] = None,
    ) -> List[Optional[List[float]]]:
        from src.modules.ai.utils.embedding_service import get_embedding_batch

        return await get_embedding_batch(texts, instruction_prefix=instruction_prefix)


class _NoOpEmbeddingService(EmbeddingService):
    """Fallback when embeddings are unavailable (CE without EE shim)."""

    async def embed_texts(
        self,
        texts: List[str],
        instruction_prefix: Optional[str] = None,
    ) -> List[Optional[List[float]]]:
        return [None] * len(texts)


_embedding_service: Optional[EmbeddingService] = None


def get_embedding_service() -> EmbeddingService:
    """Return the active embedding service (EE shim when enabled, else no-op)."""
    global _embedding_service
    if _embedding_service is not None:
        return _embedding_service

    if is_ee_enabled():
        try:
            from src.modules.ai.utils.embedding_service import get_embedding_batch  # noqa: F401

            _embedding_service = _EEEmbeddingService()
            return _embedding_service
        except ImportError:
            logger.warning("EE embedding service unavailable; using no-op fallback")

    _embedding_service = _NoOpEmbeddingService()
    return _embedding_service
