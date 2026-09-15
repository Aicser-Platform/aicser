"""Tests for DocumentIngestionService.ingest_document()'s document_id/
object_key params.

Context: Problem 2's fix moves ingestion off the request thread and into an
ARQ background job. The router now creates the KnowledgeDocument row up
front (status="processing") so the HTTP response can hand back a real
document id immediately, then enqueues a job that eventually calls
ingest_document() itself. ingest_document() must reuse that SAME row (via
its new document_id param) instead of silently inserting a second one --
the router's caller (and the frontend) only ever learn about the first id.
"""

import uuid

import pytest
from unittest.mock import AsyncMock, MagicMock

from src.modules.knowledge.models import KnowledgeDocument
from src.modules.knowledge.services.document_ingestion_service import (
    DocumentIngestionService,
    RawSection,
)


@pytest.mark.asyncio
async def test_ingest_document_reuses_precreated_row_instead_of_inserting_second_one(tmp_path):
    doc_id = uuid.uuid4()
    placeholder = KnowledgeDocument(
        id=doc_id,
        data_source_id="ds-1",
        user_id=uuid.uuid4(),
        filename="placeholder.txt",
        status="processing",
    )

    session = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    added_rows = []
    session.add = MagicMock(side_effect=lambda row: added_rows.append(row))

    dedup_result = MagicMock()
    dedup_result.scalar_one_or_none.return_value = None  # no dup hit
    row_result = MagicMock()
    row_result.scalar_one_or_none.return_value = placeholder  # the pre-created row
    update_result = MagicMock()
    session.execute = AsyncMock(side_effect=[dedup_result, row_result, update_result])

    service = DocumentIngestionService(session)
    service._parse_file = AsyncMock(return_value=([RawSection(text="hello world")], {}))
    service._embed_and_store = AsyncMock(return_value=1)

    test_file = tmp_path / "doc.txt"
    test_file.write_text("hello world")

    result = await service.ingest_document(
        file_path=str(test_file),
        data_source_id="ds-1",
        user_id="user-1",
        filename="report.pdf",
        document_id=doc_id,
        object_key="user_files/ce/abc123",
    )

    assert result.id == doc_id
    assert result.object_key == "user_files/ce/abc123"
    assert result.status == "ready"
    assert added_rows == []  # no second row inserted -- the placeholder was reused


@pytest.mark.asyncio
async def test_ingest_document_raises_when_document_id_has_no_matching_row(tmp_path):
    """A document_id that doesn't correspond to any row is a programming
    error in the caller (the router should always create it first) -- fail
    loudly rather than silently ingesting into nothing."""
    session = MagicMock()
    dedup_result = MagicMock()
    dedup_result.scalar_one_or_none.return_value = None
    missing_row_result = MagicMock()
    missing_row_result.scalar_one_or_none.return_value = None
    session.execute = AsyncMock(side_effect=[dedup_result, missing_row_result])

    service = DocumentIngestionService(session)

    test_file = tmp_path / "doc.txt"
    test_file.write_text("hello")

    with pytest.raises(ValueError, match="not found"):
        await service.ingest_document(
            file_path=str(test_file),
            data_source_id="ds-1",
            user_id="user-1",
            filename="report.pdf",
            document_id=uuid.uuid4(),
        )


@pytest.mark.asyncio
async def test_ingest_document_dedup_folds_placeholder_onto_existing_ready_doc(tmp_path):
    """DEDUP: when a byte-identical file was already successfully ingested
    for this data source, no new parse/chunk/embed work happens -- but a
    placeholder row (created by the router before the HTTP response was
    already returned to the caller) must still end up "ready" with the
    existing document's results, not stuck at "processing" forever."""
    placeholder_id = uuid.uuid4()
    existing_ready_doc = KnowledgeDocument(
        id=uuid.uuid4(),
        data_source_id="ds-1",
        user_id=uuid.uuid4(),
        filename="original.txt",
        status="ready",
        chunk_count=7,
        doc_metadata={"word_count": 42},
    )
    refreshed_placeholder = KnowledgeDocument(
        id=placeholder_id,
        data_source_id="ds-1",
        user_id=uuid.uuid4(),
        filename="report.pdf",
        status="ready",
        chunk_count=7,
        doc_metadata={"word_count": 42},
    )

    session = MagicMock()
    session.commit = AsyncMock()

    dedup_result = MagicMock()
    dedup_result.scalar_one_or_none.return_value = existing_ready_doc
    update_result = MagicMock()
    refetch_result = MagicMock()
    refetch_result.scalar_one.return_value = refreshed_placeholder
    session.execute = AsyncMock(side_effect=[dedup_result, update_result, refetch_result])

    service = DocumentIngestionService(session)

    test_file = tmp_path / "doc.txt"
    test_file.write_text("duplicate content")

    result = await service.ingest_document(
        file_path=str(test_file),
        data_source_id="ds-1",
        user_id="user-1",
        filename="report.pdf",
        document_id=placeholder_id,
        object_key="user_files/ce/dup",
    )

    assert result.id == placeholder_id
    assert result.status == "ready"
    assert result.chunk_count == 7
