"""Tests for RAG retrieval health reporting."""

import pytest
from unittest.mock import AsyncMock, MagicMock

from src.modules.knowledge.services.rag_retrieval_service import RAGRetrievalService, _cosine_similarity


def test_cosine_similarity_identical_vectors():
    vec = [1.0, 0.0, 0.0]
    assert _cosine_similarity(vec, vec) == pytest.approx(1.0, abs=1e-6)


def test_cosine_similarity_orthogonal_vectors():
    a = [1.0, 0.0]
    b = [0.0, 1.0]
    assert _cosine_similarity(a, b) == pytest.approx(0.0, abs=1e-6)


@pytest.mark.asyncio
async def test_retrieval_health_reports_backend():
    session = MagicMock()
    ext_result = MagicMock()
    ext_result.first.return_value = None
    col_result = MagicMock()
    col_result.first.return_value = None
    stats_result = MagicMock()
    stats_result.mappings.return_value.first.return_value = {"total": 0, "with_json_embedding": 0}
    session.execute = AsyncMock(side_effect=[ext_result, col_result, stats_result])

    svc = RAGRetrievalService(session)
    report = await svc.retrieval_health()

    assert report["backend"] == "jsonb_hybrid"
    assert report["healthy"] is True
    assert report["total_chunks"] == 0
