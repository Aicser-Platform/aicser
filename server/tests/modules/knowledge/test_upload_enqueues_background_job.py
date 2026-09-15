"""Tests for Problem 2's fix: KB document ingestion no longer blocks the
HTTP request.

Context: /knowledge/create and /knowledge/upload used to call
DocumentIngestionService.ingest_document() directly inline -- parsing +
chunking + embedding ALL happened before the HTTP response returned. A
normal multi-page PDF (chunked at CHUNK_TARGET_TOKENS=600 tokens/chunk) can
take real CPU time to embed with a local model and no GPU, risking
reverse-proxy/client timeouts. Both endpoints now: store the file (Problem
1's object-storage fix), create the KnowledgeDocument row up front with
status="processing", enqueue an ARQ job (ingest_knowledge_document), and
return immediately -- ingestion happens later, in the worker.
"""

import io
import uuid

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import UploadFile

from src.modules.knowledge.models import KnowledgeDocument
from src.modules.knowledge.router import create_knowledge_base, upload_knowledge_document


def _session_with_pending_document(doc_id, data_source_id, filename, object_key):
    """A session mock good enough for _create_pending_document's
    add/commit/refresh sequence (refresh is a no-op since the row we added
    is already fully populated)."""
    session = AsyncMock()
    added = []

    def _add(row):
        added.append(row)

    session.add = MagicMock(side_effect=_add)
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    return session, added


@pytest.mark.asyncio
async def test_upload_knowledge_document_enqueues_job_instead_of_blocking():
    """The core Problem 2 regression check: ingest_document() must NOT be
    awaited inline in the request handler anymore -- only enqueue_job()."""
    upload = UploadFile(file=io.BytesIO(b"pdf bytes"), filename="report.pdf")
    session = AsyncMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    # _resolve_data_source_project_id's SELECT
    project_lookup = MagicMock()
    project_lookup.first.return_value = None
    session.execute = AsyncMock(return_value=project_lookup)

    current_token = {"id": str(uuid.uuid4())}

    with patch("src.modules.knowledge.router.require_permission", new=AsyncMock(return_value=True)), \
         patch(
             "src.modules.data.services.upload_datasource_storage_service.UploadDatasourceStorageService"
         ) as mock_storage_cls, \
         patch("src.shared.jobs.client.enqueue_job", new=AsyncMock(return_value="job-123")) as mock_enqueue, \
         patch(
             "src.modules.knowledge.services.document_ingestion_service.DocumentIngestionService.ingest_document",
             new=AsyncMock(side_effect=AssertionError("ingest_document must not be called inline")),
         ):
        mock_storage = MagicMock()
        mock_storage.store_file = AsyncMock(return_value="user_files/ce/xyz")
        mock_storage.storage_type = "postgresql"
        mock_storage_cls.return_value = mock_storage

        response = await upload_knowledge_document(
            file=upload,
            data_source_id="ds-1",
            session=session,
            current_token=current_token,
        )

    assert response.status == "processing"
    assert response.success is True
    assert response.document_id
    mock_enqueue.assert_awaited_once()
    call_kwargs = mock_enqueue.call_args.kwargs
    assert call_kwargs["object_key"] == "user_files/ce/xyz"
    assert call_kwargs["data_source_id"] == "ds-1"
    assert call_kwargs["filename"] == "report.pdf"
    assert mock_enqueue.call_args.args[0] == "ingest_knowledge_document"


@pytest.mark.asyncio
async def test_create_knowledge_base_enqueues_job_per_file_instead_of_blocking():
    """Same regression check for the /create (data-source + upload in one
    call) endpoint's per-file loop."""
    upload = UploadFile(file=io.BytesIO(b"doc bytes"), filename="notes.txt")
    session = AsyncMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    session.execute = AsyncMock(return_value=MagicMock())

    current_token = {"id": str(uuid.uuid4())}

    with patch("src.modules.knowledge.router.require_permission", new=AsyncMock(return_value=True)), \
         patch(
             "src.modules.knowledge.router._create_kb_data_source",
             new=AsyncMock(return_value="ds-new-1"),
         ), \
         patch("src.core.edition.is_ee_enabled", return_value=False), \
         patch(
             "src.modules.data.services.upload_datasource_storage_service.UploadDatasourceStorageService"
         ) as mock_storage_cls, \
         patch("src.shared.jobs.client.enqueue_job", new=AsyncMock(return_value="job-456")) as mock_enqueue, \
         patch(
             "src.modules.knowledge.services.document_ingestion_service.DocumentIngestionService.ingest_document",
             new=AsyncMock(side_effect=AssertionError("ingest_document must not be called inline")),
         ):
        mock_storage = MagicMock()
        mock_storage.store_file = AsyncMock(return_value="user_files/ce/def456")
        mock_storage.storage_type = "postgresql"
        mock_storage_cls.return_value = mock_storage

        response = await create_knowledge_base(
            name="My KB",
            description="",
            project_id=None,
            files=[upload],
            session=session,
            current_token=current_token,
        )

    assert response.success is True
    assert response.data_source_id == "ds-new-1"
    assert len(response.documents) == 1
    doc_result = response.documents[0]
    assert doc_result.status == "processing"
    assert doc_result.success is True
    mock_enqueue.assert_awaited_once()
    assert mock_enqueue.call_args.args[0] == "ingest_knowledge_document"
    assert mock_enqueue.call_args.kwargs["data_source_id"] == "ds-new-1"
