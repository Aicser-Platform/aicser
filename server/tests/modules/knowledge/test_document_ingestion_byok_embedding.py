"""Tests for document_ingestion_service.py's org BYOK embedding wiring.

Context: embeddings used to be entirely platform-wide (one EMBEDDING_PROVIDER
env var for the whole deployment) with no BYOK path at all -- unlike chat
completions, which had per-user/org BYOK via user_byok_models.py. This closes
that gap for document ingestion specifically: the uploader's organization_id
is resolved once per document and threaded into every embed_text() call for
that document's chunks, and the *actually resolved* model identity (which
reflects an org BYOK key when the org has one) is what gets persisted on
DocumentChunk.embedding_model -- not a separately-resolved, potentially
different, "current platform default" value.
"""

import uuid

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
class TestResolveOrganizationId:
    async def test_returns_none_when_user_id_missing(self):
        from src.modules.knowledge.services.document_ingestion_service import DocumentIngestionService

        service = DocumentIngestionService(MagicMock())

        assert await service._resolve_organization_id(None) is None
        assert await service._resolve_organization_id("") is None

    async def test_returns_none_when_ee_not_enabled(self, monkeypatch):
        from src.modules.knowledge.services.document_ingestion_service import DocumentIngestionService

        monkeypatch.setattr("src.core.edition.is_ee_enabled", lambda: False)
        service = DocumentIngestionService(MagicMock())

        assert await service._resolve_organization_id("user-1") is None

    async def test_resolves_organization_id_when_ee_enabled(self, monkeypatch):
        from src.modules.knowledge.services.document_ingestion_service import DocumentIngestionService

        monkeypatch.setattr("src.core.edition.is_ee_enabled", lambda: True)

        async def fake_resolve(user_id, organization_id):
            assert user_id == "user-1"
            assert organization_id is None
            return "org-42"

        monkeypatch.setattr(
            "ee.modules.ai.services.user_byok_models._resolve_user_organization_id",
            fake_resolve,
        )
        service = DocumentIngestionService(MagicMock())

        assert await service._resolve_organization_id("user-1") == "org-42"

    async def test_never_raises_even_if_resolution_fails(self, monkeypatch):
        """Must never block ingestion -- a lookup failure just means no org
        BYOK embedding config is used, same as if the org had none."""
        from src.modules.knowledge.services.document_ingestion_service import DocumentIngestionService

        monkeypatch.setattr("src.core.edition.is_ee_enabled", lambda: True)

        async def fake_resolve(user_id, organization_id):
            raise RuntimeError("db down")

        monkeypatch.setattr(
            "ee.modules.ai.services.user_byok_models._resolve_user_organization_id",
            fake_resolve,
        )
        service = DocumentIngestionService(MagicMock())

        assert await service._resolve_organization_id("user-1") is None


@pytest.mark.asyncio
async def test_embed_and_store_threads_organization_id_and_persists_resolved_identity(monkeypatch):
    """The chunk's stored embedding_model must be whatever the embedding
    service actually resolved for THIS organization_id (org BYOK identity
    when configured), not a separately-fetched platform-only value that
    could silently disagree with what was actually used to produce the
    vector."""
    from src.modules.knowledge.services.document_ingestion_service import (
        ChunkData,
        DocumentIngestionService,
    )

    mock_session = AsyncMock()
    mock_session.execute = AsyncMock(return_value=MagicMock())
    added_rows = []
    mock_session.add = MagicMock(side_effect=lambda row: added_rows.append(row))

    service = DocumentIngestionService(mock_session)
    monkeypatch.setattr(service, "_pgvector_available_check", AsyncMock(return_value=False))
    monkeypatch.setattr(service, "_resolve_organization_id", AsyncMock(return_value="org-42"))

    fake_embedding_service = MagicMock()

    async def fake_embed_text(content, organization_id=None):
        assert organization_id == "org-42"
        return [0.1, 0.2]

    fake_embedding_service.embed_text = fake_embed_text
    fake_embedding_service.current_model_id_async = AsyncMock(
        return_value="byok_org:openai:text-embedding-3-small"
    )

    with patch(
        "src.modules.knowledge.services.document_ingestion_service.get_embedding_service",
        return_value=fake_embedding_service,
    ):
        chunks = [ChunkData(content="hello world", token_count=2, chunk_index=0)]
        stored = await service._embed_and_store(uuid.uuid4(), "ds-1", chunks, user_id="user-1")

    assert stored == 1
    assert len(added_rows) == 1
    assert added_rows[0].embedding_model == "byok_org:openai:text-embedding-3-small"
    assert added_rows[0].embedding == [0.1, 0.2]


@pytest.mark.asyncio
async def test_embed_and_store_without_user_id_behaves_exactly_as_before(monkeypatch):
    """No user_id (e.g. an internal/system-triggered ingestion path) must
    resolve organization_id to None and fall back to the platform-wide
    config -- unchanged from before org BYOK embeddings existed."""
    from src.modules.knowledge.services.document_ingestion_service import (
        ChunkData,
        DocumentIngestionService,
    )

    mock_session = AsyncMock()
    mock_session.execute = AsyncMock(return_value=MagicMock())
    added_rows = []
    mock_session.add = MagicMock(side_effect=lambda row: added_rows.append(row))

    service = DocumentIngestionService(mock_session)
    monkeypatch.setattr(service, "_pgvector_available_check", AsyncMock(return_value=False))

    fake_embedding_service = MagicMock()

    async def fake_embed_text(content, organization_id=None):
        assert organization_id is None
        return [0.3]

    fake_embedding_service.embed_text = fake_embed_text
    fake_embedding_service.current_model_id_async = AsyncMock(return_value="local:BAAI/bge-small-en-v1.5")

    with patch(
        "src.modules.knowledge.services.document_ingestion_service.get_embedding_service",
        return_value=fake_embedding_service,
    ):
        chunks = [ChunkData(content="hello", token_count=1, chunk_index=0)]
        await service._embed_and_store(uuid.uuid4(), "ds-1", chunks)

    assert added_rows[0].embedding_model == "local:BAAI/bge-small-en-v1.5"
