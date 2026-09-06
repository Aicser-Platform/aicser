"""Tests for Problem 1's fix: KB document uploads are durably/S3-compatibly
stored.

Context: the old _save_uploaded_file() wrote uploaded bytes straight to a
local UPLOAD_DIR/knowledge/<uuid>.<ext> path (a Docker volume -- survives
restarts, but not S3-compatible or horizontally scalable) and never deleted
or re-referenced it afterward -- a pure disk leak, and the only KB ingestion
entry point that persisted to a non-ephemeral location at all. This routes
the same bytes through UploadDatasourceStorageService instead, the same
S3/Azure Blob/PostgreSQL-backed object storage CSV/datasource uploads
already use (see upload_datasource_storage_service.py), and returns its
object_key rather than a filesystem path.
"""

import io

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException, UploadFile

from src.modules.knowledge.router import (
    _create_pending_document,
    _resolve_data_source_project_id,
    _store_uploaded_file,
)


@pytest.mark.asyncio
async def test_store_uploaded_file_rejects_disallowed_extension():
    upload = UploadFile(file=io.BytesIO(b"not a doc"), filename="virus.exe")
    with pytest.raises(HTTPException) as exc_info:
        await _store_uploaded_file(upload, "ds-1", None, "user-1")
    assert exc_info.value.status_code == 400
    assert "Unsupported file type" in exc_info.value.detail


@pytest.mark.asyncio
async def test_store_uploaded_file_rejects_missing_filename():
    upload = UploadFile(file=io.BytesIO(b"data"), filename=None)
    with pytest.raises(HTTPException) as exc_info:
        await _store_uploaded_file(upload, "ds-1", None, "user-1")
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_store_uploaded_file_rejects_oversized_file(monkeypatch):
    from src.core.config import settings

    monkeypatch.setattr(settings, "MAX_FILE_SIZE_MB", 0)
    upload = UploadFile(file=io.BytesIO(b"x" * 10), filename="doc.txt")
    with pytest.raises(HTTPException) as exc_info:
        await _store_uploaded_file(upload, "ds-1", None, "user-1")
    assert exc_info.value.status_code == 400
    assert "too large" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_store_uploaded_file_routes_bytes_through_object_storage_not_local_disk():
    """Must call UploadDatasourceStorageService.store_file (same backend
    CSV/datasource uploads use) and return its object_key -- not write
    anywhere on local disk."""
    upload = UploadFile(file=io.BytesIO(b"hello knowledge base"), filename="report.pdf")

    mock_storage = MagicMock()
    mock_storage.store_file = AsyncMock(return_value="user_files/proj-1/abc123")
    mock_storage.storage_type = "postgresql"

    with patch(
        "src.modules.data.services.upload_datasource_storage_service.UploadDatasourceStorageService",
        return_value=mock_storage,
    ):
        object_key = await _store_uploaded_file(upload, "ds-1", "proj-1", "user-1")

    assert object_key == "user_files/proj-1/abc123"
    mock_storage.store_file.assert_awaited_once()
    call_kwargs = mock_storage.store_file.call_args.kwargs
    assert call_kwargs["file_content"] == b"hello knowledge base"
    assert call_kwargs["project_id"] == "proj-1"
    # source_id scopes the object storage path to the owning data source,
    # same convention data_connectivity_service.py uses for CSV uploads.
    assert call_kwargs["source_id"] == "ds-1"
    assert call_kwargs["original_filename"] == "report.pdf"
    assert call_kwargs["user_id"] == "user-1"


@pytest.mark.asyncio
async def test_create_pending_document_sets_processing_status_and_object_key():
    """The router creates this row up front (status="processing") so the
    HTTP response can return a real document id immediately, before the
    background ingestion job (Problem 2's fix) has even started."""
    session = AsyncMock()
    added = []
    session.add = MagicMock(side_effect=lambda row: added.append(row))

    doc = await _create_pending_document(
        session, "ds-1", "user-1", "report.pdf", "user_files/proj-1/abc123",
    )

    assert doc.status == "processing"
    assert doc.object_key == "user_files/proj-1/abc123"
    assert doc.file_type == "pdf"
    assert doc.data_source_id == "ds-1"
    assert added == [doc]
    session.commit.assert_awaited_once()
    session.refresh.assert_awaited_once()


@pytest.mark.asyncio
async def test_resolve_data_source_project_id_returns_none_on_lookup_failure():
    """Best-effort: a lookup failure must fall back to unscoped (CE-style)
    storage rather than blocking upload/download."""
    session = AsyncMock()
    session.execute = AsyncMock(side_effect=RuntimeError("db down"))
    result = await _resolve_data_source_project_id("ds-1", session)
    assert result is None


@pytest.mark.asyncio
async def test_resolve_data_source_project_id_returns_value_when_found():
    session = AsyncMock()
    row_result = MagicMock()
    row_result.first.return_value = ("proj-42",)
    session.execute = AsyncMock(return_value=row_result)
    result = await _resolve_data_source_project_id("ds-1", session)
    assert result == "proj-42"
