"""Tests for query pattern feedback wiring."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_update_score_by_nl_query_decrements_on_negative_feedback():
    from ee.modules.ai.services.query_pattern_service import QueryPatternService

    service = QueryPatternService()
    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.rowcount = 1
    mock_session.execute = AsyncMock(return_value=mock_result)
    mock_session.commit = AsyncMock()

    mock_cm = AsyncMock()
    mock_cm.__aenter__.return_value = mock_session
    mock_cm.__aexit__.return_value = None
    mock_factory = MagicMock(return_value=mock_cm)

    with patch.object(service, "_get_session_factory", return_value=mock_factory):
        ok = await service.update_score_by_nl_query(
            nl_query="show sales by region",
            schema_hash="abc123",
            delta=-1,
        )
    assert ok is True
    mock_session.commit.assert_awaited()


def test_retrieve_similar_has_no_broken_embedding_vector_ann():
    """query_patterns has no embedding_vector column at all (unlike
    document_chunks) -- an ANN branch querying it always raised
    UndefinedColumnError, and before that even parsed, `:qvec::vector` broke
    SQLAlchemy's text() parameter binding outright (a known gotcha, same bug
    as rag_retrieval_service.py's _retrieve_pgvector). Both were caught
    without a rollback, poisoning the session so the JSONB fallback query
    right after failed too -- returning zero few-shot NL2SQL examples for
    every request. Removed rather than patched: the column doesn't exist to
    query in the first place. Guard against reintroducing either shape."""
    import inspect
    from ee.modules.ai.services.query_pattern_service import QueryPatternService

    source = "\n".join(
        line for line in inspect.getsource(QueryPatternService.retrieve_similar).splitlines()
        if not line.strip().startswith("#")
    )
    assert "::vector" not in source
    assert "embedding_vector" not in source
