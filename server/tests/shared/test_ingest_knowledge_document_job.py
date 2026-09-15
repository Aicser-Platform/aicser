"""Tests for the ingest_knowledge_document background job.

Context: /knowledge/create and /knowledge/upload used to call
DocumentIngestionService.ingest_document() inline in the request handler --
parsing + chunking + embedding all happened before the HTTP response
returned, risking reverse-proxy/client timeouts on a normal multi-page PDF.
This job is what the router now enqueues instead: fetch the original bytes
back from object storage (Problem 1's fix), write a short-lived local
tempfile for DocumentIngestionService's parsers, ingest, then clean up the
tempfile regardless of outcome.
"""

import os

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_ingest_knowledge_document_writes_and_cleans_up_tempfile():
    """The tempfile written for the parser to read from must exist during
    ingestion and be gone afterward -- same ephemeral-tempfile pattern
    ee/modules/knowledge_connectors/router.py already uses for its own
    ingestion inputs, just sourced from object storage instead of a
    synthesized string."""
    from src.shared.jobs.tasks import ingest_knowledge_document

    document_id = "11111111-1111-1111-1111-111111111111"
    captured_tmp_path = {}

    fake_doc = MagicMock()
    fake_doc.status = "ready"
    fake_doc.chunk_count = 3

    async def fake_ingest_document(self, file_path, data_source_id, user_id, filename=None, document_id=None, object_key=None):
        captured_tmp_path["path"] = file_path
        assert os.path.exists(file_path), "tempfile must exist while ingestion runs"
        with open(file_path, "rb") as f:
            assert f.read() == b"%PDF-1.4 fake bytes"
        return fake_doc

    mock_storage = MagicMock()
    mock_storage.get_file = AsyncMock(return_value=b"%PDF-1.4 fake bytes")

    mock_session = AsyncMock()
    mock_cm = AsyncMock()
    mock_cm.__aenter__.return_value = mock_session
    mock_cm.__aexit__.return_value = None

    with patch("src.db.session.async_session", return_value=mock_cm), \
         patch(
             "src.modules.data.services.upload_datasource_storage_service.UploadDatasourceStorageService",
             return_value=mock_storage,
         ), \
         patch(
             "src.modules.knowledge.services.document_ingestion_service.DocumentIngestionService.ingest_document",
             new=fake_ingest_document,
         ):
        result = await ingest_knowledge_document(
            {},
            document_id=document_id,
            object_key="user_files/ce/abc123",
            data_source_id="ds-1",
            user_id="user-1",
            filename="report.pdf",
            project_id=None,
        )

    assert result["success"] is True
    assert result["document_id"] == document_id
    assert result["status"] == "ready"
    assert result["chunk_count"] == 3
    # The tempfile must be deleted after ingestion, success or not.
    assert not os.path.exists(captured_tmp_path["path"])


@pytest.mark.asyncio
async def test_ingest_knowledge_document_marks_document_failed_when_storage_fetch_fails():
    """If object storage can't return the bytes (deleted out-of-band,
    backend misconfigured), the router-created placeholder row must not be
    left stuck at status="processing" forever -- mark it failed with a
    useful error_message, same place any other ingestion failure surfaces to
    the KB documents UI."""
    from src.shared.jobs.tasks import ingest_knowledge_document

    document_id = "22222222-2222-2222-2222-222222222222"

    mock_storage = MagicMock()
    mock_storage.get_file = AsyncMock(side_effect=ValueError("File not found: user_files/ce/gone"))

    mock_session = AsyncMock()
    mock_cm = AsyncMock()
    mock_cm.__aenter__.return_value = mock_session
    mock_cm.__aexit__.return_value = None

    with patch("src.db.session.async_session", return_value=mock_cm), \
         patch(
             "src.modules.data.services.upload_datasource_storage_service.UploadDatasourceStorageService",
             return_value=mock_storage,
         ):
        result = await ingest_knowledge_document(
            {},
            document_id=document_id,
            object_key="user_files/ce/gone",
            data_source_id="ds-1",
            user_id="user-1",
            filename="report.pdf",
            project_id=None,
        )

    assert result["success"] is False
    assert result["document_id"] == document_id
    mock_session.execute.assert_awaited_once()
    mock_session.commit.assert_awaited_once()
