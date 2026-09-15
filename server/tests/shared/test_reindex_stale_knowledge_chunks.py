"""Tests for the reindex_stale_knowledge_chunks background job.

Context: every document_chunks row in this deployment had NULL embedding and
NULL embedding_vector -- not just the one document that surfaced the
transaction-poisoning bug, all 258 rows, checked directly against the live
database before writing this job. Fixing the write path (CAST() instead of
::, rollback-on-exception) only fixes ingestion going forward; it does
nothing for rows already stuck NULL, or rows embedded under a since-changed
EMBEDDING_MODEL. This job is the backfill for both.
"""

import json

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_noop_when_nothing_is_stale():
    from src.shared.jobs.tasks import reindex_stale_knowledge_chunks

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.all.return_value = []
    mock_session.execute = AsyncMock(return_value=mock_result)

    mock_cm = AsyncMock()
    mock_cm.__aenter__.return_value = mock_session
    mock_cm.__aexit__.return_value = None

    with patch("src.db.session.async_session", return_value=mock_cm):
        result = await reindex_stale_knowledge_chunks({})

    assert result["success"] is True
    assert result["reembedded"] == 0
    mock_session.commit.assert_not_called()


@pytest.mark.asyncio
async def test_reembeds_stale_chunks_and_writes_both_columns():
    from src.shared.jobs.tasks import reindex_stale_knowledge_chunks

    chunk_id = "11111111-1111-1111-1111-111111111111"
    select_result = MagicMock()
    select_result.all.return_value = [(chunk_id, "some chunk text")]
    pgvector_check_result = MagicMock()
    pgvector_check_result.scalar.return_value = True

    mock_session = AsyncMock()
    # First execute: the SELECT for stale chunks. Second: the pgvector
    # availability check. Remaining: the UPDATE statements (return value
    # unused for those).
    mock_session.execute = AsyncMock(
        side_effect=[select_result, pgvector_check_result, MagicMock(), MagicMock()]
    )

    mock_cm = AsyncMock()
    mock_cm.__aenter__.return_value = mock_session
    mock_cm.__aexit__.return_value = None

    fake_embedding_service = MagicMock()
    fake_embedding_service.current_model_id.return_value = "local:BAAI/bge-small-en-v1.5"
    fake_embedding_service.embed_texts = AsyncMock(return_value=[[0.1] * 384])

    with patch("src.db.session.async_session", return_value=mock_cm), \
         patch("src.shared.embedding.get_embedding_service", return_value=fake_embedding_service), \
         patch(
             "src.modules.knowledge.services.document_ingestion_service.PGVECTOR_EMBEDDING_DIMENSIONS",
             384,
         ):
        result = await reindex_stale_knowledge_chunks({})

    assert result["success"] is True
    assert result["reembedded"] == 1
    assert result["failed"] == 0
    mock_session.commit.assert_awaited_once()

    # 4 execute calls: SELECT stale chunks, pgvector availability check,
    # UPDATE embedding/model/dims, UPDATE embedding_vector (dimension matched).
    assert mock_session.execute.await_count == 4
    vector_update_call = mock_session.execute.await_args_list[-1]
    assert "embedding_vector" in str(vector_update_call.args[0])
    assert vector_update_call.args[1]["id"] == chunk_id


@pytest.mark.asyncio
async def test_stale_query_excludes_org_byok_embedded_chunks():
    """This job has no per-organization context -- it scans document_chunks
    across every org in one global pass, comparing embedding_model against a
    single platform-wide current_model_id. A chunk embedded via an org's BYOK
    key (see user_byok_embedding.py) is tagged "byok_org:<provider>:...",
    which never equals the platform id -- without the exclusion, this job
    would treat every such chunk as stale on every run and silently
    re-embed it with the platform default, clobbering the org's deliberate
    BYOK choice forever. The SELECT must exclude embedding_model LIKE
    'byok_org:%' from its staleness comparison."""
    from src.shared.jobs.tasks import reindex_stale_knowledge_chunks

    select_result = MagicMock()
    select_result.all.return_value = []

    mock_session = AsyncMock()
    mock_session.execute = AsyncMock(return_value=select_result)

    mock_cm = AsyncMock()
    mock_cm.__aenter__.return_value = mock_session
    mock_cm.__aexit__.return_value = None

    fake_embedding_service = MagicMock()
    fake_embedding_service.current_model_id.return_value = "local:BAAI/bge-small-en-v1.5"

    with patch("src.db.session.async_session", return_value=mock_cm), \
         patch("src.shared.embedding.get_embedding_service", return_value=fake_embedding_service):
        await reindex_stale_knowledge_chunks({})

    stmt = mock_session.execute.await_args_list[0].args[0]
    compiled = str(stmt.compile(compile_kwargs={"literal_binds": True}))
    assert "byok_org:%" in compiled
    assert "NOT" in compiled.upper() or "!~~" in compiled or "NOT LIKE" in compiled.upper()


@pytest.mark.asyncio
async def test_skips_pgvector_write_when_dimension_does_not_match_column():
    """A non-default embedding model (e.g. an API provider producing 1536-dim
    vectors while the column is sized for the 384-dim local default) must
    still update the JSONB embedding -- just not the fixed-width ANN column,
    matching the same guard document_ingestion_service.py's write path uses."""
    from src.shared.jobs.tasks import reindex_stale_knowledge_chunks

    chunk_id = "22222222-2222-2222-2222-222222222222"
    select_result = MagicMock()
    select_result.all.return_value = [(chunk_id, "some chunk text")]
    pgvector_check_result = MagicMock()
    pgvector_check_result.scalar.return_value = True

    mock_session = AsyncMock()
    mock_session.execute = AsyncMock(
        side_effect=[select_result, pgvector_check_result, MagicMock()]
    )

    mock_cm = AsyncMock()
    mock_cm.__aenter__.return_value = mock_session
    mock_cm.__aexit__.return_value = None

    fake_embedding_service = MagicMock()
    fake_embedding_service.current_model_id.return_value = "openai:text-embedding-3-small"
    fake_embedding_service.embed_texts = AsyncMock(return_value=[[0.1] * 1536])

    with patch("src.db.session.async_session", return_value=mock_cm), \
         patch("src.shared.embedding.get_embedding_service", return_value=fake_embedding_service), \
         patch(
             "src.modules.knowledge.services.document_ingestion_service.PGVECTOR_EMBEDDING_DIMENSIONS",
             384,
         ):
        result = await reindex_stale_knowledge_chunks({})

    assert result["reembedded"] == 1
    # Only 3 execute calls -- no embedding_vector UPDATE, since 1536 != 384.
    assert mock_session.execute.await_count == 3
