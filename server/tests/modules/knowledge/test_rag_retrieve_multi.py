"""Tests for multi-library RAG retrieval."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.modules.knowledge.services.rag_retrieval_service import RAGRetrievalService, RetrievedChunk


@pytest.mark.asyncio
async def test_retrieve_multi_dedupes_by_chunk_id():
    svc = RAGRetrievalService(MagicMock())
    chunk_a = RetrievedChunk("c1", "d1", "hello", 0.9, 10)
    chunk_b = RetrievedChunk("c1", "d1", "hello", 0.5, 10)
    chunk_c = RetrievedChunk("c2", "d2", "world", 0.8, 8)

    with patch.object(svc, "retrieve", new=AsyncMock(side_effect=[[chunk_a], [chunk_b, chunk_c]])):
        results = await svc.retrieve_multi("query", ["ds1", "ds2"], top_k_per_source=5, global_top_k=8)

    assert len(results) == 2
    assert results[0].chunk_id == "c1"
    assert results[0].score == 0.9
    assert results[1].chunk_id == "c2"
