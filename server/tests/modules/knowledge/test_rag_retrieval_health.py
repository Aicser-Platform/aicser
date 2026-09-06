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


def _code_only(source: str) -> str:
    """Strip full-line comments so a source-inspection assertion checks
    executable code, not explanatory comments that quote the bug pattern
    they're warning against (as several of these fixes' comments do)."""
    return "\n".join(line for line in source.splitlines() if not line.strip().startswith("#"))


def test_pgvector_query_uses_cast_not_double_colon():
    """`:param::vector` is a known SQLAlchemy text() gotcha: the Postgres `::`
    cast operator right after a `:bindparam` name breaks SQLAlchemy's
    parameter parsing outright (PostgresSyntaxError), which was previously
    caught silently (logger.debug) and left the session's transaction
    poisoned -- so the very fallback query this file's JSONB path is meant to
    provide failed too, with a different, misleading
    InFailedSQLTransactionError, for every RAG query hitting a knowledge base
    (reproduced live against this deployment's own database, not simulated).
    CAST(:param AS vector) is the fix; guard against the regression."""
    import inspect
    from src.modules.knowledge.services.rag_retrieval_service import RAGRetrievalService

    source = _code_only(inspect.getsource(RAGRetrievalService._retrieve_pgvector))
    assert "::vector" not in source, "reintroduces the broken SQLAlchemy text() cast shorthand"
    assert "CAST(" in source and "AS vector)" in source


def test_pgvector_query_uses_actual_metadata_column_name():
    """The raw SQL referenced `dc.chunk_metadata` -- that's the ORM
    *attribute* name (DocumentChunk.chunk_metadata = Column("metadata", ...)),
    not the real column name. Raw text() SQL bypasses the ORM's name mapping
    entirely, so it must use the real column name -- confirmed against the
    live schema (\\d document_chunks shows `metadata`, not `chunk_metadata`)."""
    import inspect
    from src.modules.knowledge.services.rag_retrieval_service import RAGRetrievalService

    source = inspect.getsource(RAGRetrievalService._retrieve_pgvector)
    assert "dc.chunk_metadata" not in source
    assert "dc.metadata" in source


@pytest.mark.asyncio
async def test_retrieve_pgvector_rolls_back_session_on_failure():
    """Without a rollback, any exception here (this specific SQL bug
    included) poisons the session's transaction for the rest of the request
    -- including the caller's own JSONB fallback query on the same session,
    which is the actual mechanism that turned one masked bug into a total
    RAG-retrieval outage."""
    session = MagicMock()
    session.rollback = AsyncMock()

    async def _availability_ok():
        return True

    svc = RAGRetrievalService(session)
    svc._pgvector_available_check = _availability_ok
    session.execute = AsyncMock(side_effect=RuntimeError("simulated pgvector failure"))

    result = await svc._retrieve_pgvector("query", [0.1, 0.2], "ds-id", 5, None)

    assert result is None
    session.rollback.assert_awaited_once()


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


def test_ingestion_embedding_vector_write_uses_cast_not_double_colon():
    """Same `:param::vector` gotcha as _retrieve_pgvector, on the write side:
    every ingestion attempt to populate embedding_vector raised
    PostgresSyntaxError, silently caught (chunks kept their JSONB embedding,
    so ingestion still "succeeded", but embedding_vector stayed permanently
    NULL for every chunk ever ingested) -- confirmed live: CAST(:vec AS
    vector) succeeds where :vec::vector doesn't, against this deployment's
    own database."""
    import inspect
    from src.modules.knowledge.services.document_ingestion_service import DocumentIngestionService

    source = _code_only(inspect.getsource(DocumentIngestionService._embed_and_store))
    assert "::vector" not in source
    assert "CAST(:vec AS vector)" in source
