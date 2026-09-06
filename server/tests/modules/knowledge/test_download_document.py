"""Tests for GET /knowledge/documents/{doc_id}/download.

Part of Problem 1's fix: once original file bytes are durably stored (see
test_upload_object_storage.py), something needs to be able to retrieve them
back. Documents ingested before object_key existed have nothing to serve --
that must be a clean 404, not a crash, since there is nothing to backfill
(their local-disk originals were never durably kept anywhere).
"""

import uuid

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from src.modules.knowledge.models import KnowledgeDocument
from src.modules.knowledge.router import download_knowledge_document


def _session_returning_document(doc):
    session = AsyncMock()
    doc_result = MagicMock()
    doc_result.scalar_one_or_none.return_value = doc
    project_result = MagicMock()
    project_result.first.return_value = None
    session.execute = AsyncMock(side_effect=[doc_result, project_result])
    return session


@pytest.mark.asyncio
async def test_download_returns_404_when_document_not_found():
    session = AsyncMock()
    not_found = MagicMock()
    not_found.scalar_one_or_none.return_value = None
    session.execute = AsyncMock(return_value=not_found)

    with patch("src.modules.knowledge.router.require_permission", new=AsyncMock(return_value=True)):
        with pytest.raises(HTTPException) as exc_info:
            await download_knowledge_document(
                doc_id=str(uuid.uuid4()),
                session=session,
                current_token={"id": str(uuid.uuid4())},
            )
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_download_returns_404_when_object_key_missing():
    """Documents ingested before this fix (or via a path that never
    persisted an original, e.g. knowledge_connectors sync) have
    object_key=None -- must not crash trying to fetch from storage."""
    user_id = uuid.uuid4()
    doc = KnowledgeDocument(
        id=uuid.uuid4(),
        data_source_id="ds-1",
        user_id=user_id,
        filename="legacy.pdf",
        file_type="pdf",
        object_key=None,
        status="ready",
    )
    session = AsyncMock()
    doc_result = MagicMock()
    doc_result.scalar_one_or_none.return_value = doc
    session.execute = AsyncMock(return_value=doc_result)

    with patch("src.modules.knowledge.router.require_permission", new=AsyncMock(return_value=True)):
        with pytest.raises(HTTPException) as exc_info:
            await download_knowledge_document(
                doc_id=str(doc.id),
                session=session,
                current_token={"id": str(user_id)},
            )
    assert exc_info.value.status_code == 404
    assert "not available" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_download_streams_original_bytes_when_object_key_present():
    user_id = uuid.uuid4()
    doc = KnowledgeDocument(
        id=uuid.uuid4(),
        data_source_id="ds-1",
        user_id=user_id,
        filename="report.pdf",
        file_type="pdf",
        object_key="user_files/ce/abc123",
        status="ready",
    )
    session = _session_returning_document(doc)

    mock_storage = MagicMock()
    mock_storage.get_file = AsyncMock(return_value=b"%PDF-1.4 fake pdf bytes")

    with patch("src.modules.knowledge.router.require_permission", new=AsyncMock(return_value=True)), \
         patch(
             "src.modules.data.services.upload_datasource_storage_service.UploadDatasourceStorageService",
             return_value=mock_storage,
         ):
        response = await download_knowledge_document(
            doc_id=str(doc.id),
            session=session,
            current_token={"id": str(user_id)},
        )

    assert isinstance(response, StreamingResponse)
    assert response.media_type == "application/pdf"
    assert 'filename="report.pdf"' in response.headers["content-disposition"]
    mock_storage.get_file.assert_awaited_once_with("user_files/ce/abc123", None)


@pytest.mark.asyncio
async def test_download_returns_404_when_storage_retrieval_fails():
    """A backend-storage error (e.g. object deleted out-of-band, bucket
    misconfigured) must surface as a clean 404, not a 500 crash."""
    user_id = uuid.uuid4()
    doc = KnowledgeDocument(
        id=uuid.uuid4(),
        data_source_id="ds-1",
        user_id=user_id,
        filename="report.pdf",
        file_type="pdf",
        object_key="user_files/ce/missing",
        status="ready",
    )
    session = _session_returning_document(doc)

    mock_storage = MagicMock()
    mock_storage.get_file = AsyncMock(side_effect=ValueError("File not found: user_files/ce/missing"))

    with patch("src.modules.knowledge.router.require_permission", new=AsyncMock(return_value=True)), \
         patch(
             "src.modules.data.services.upload_datasource_storage_service.UploadDatasourceStorageService",
             return_value=mock_storage,
         ):
        with pytest.raises(HTTPException) as exc_info:
            await download_knowledge_document(
                doc_id=str(doc.id),
                session=session,
                current_token={"id": str(user_id)},
            )
    assert exc_info.value.status_code == 404
