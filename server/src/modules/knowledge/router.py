"""
Knowledge Base REST API — upload, list, detail, delete, and search endpoints.

Mounted at /knowledge prefix in the main API router.
"""

import logging
import os
import uuid
from typing import List, Optional, Union

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.modules.knowledge.models import DocumentChunk, KnowledgeDocument
from src.db.session import get_async_session
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.authentication.rbac.guard import require_permission
from src.modules.knowledge.schemas import (
    CitationOut,
    KnowledgeDocumentOut,
    KnowledgeDocumentUpdate,
    KnowledgeSearchRequest,
    KnowledgeSearchResponse,
    KnowledgeUploadResponse,
    RetrievedChunkOut,
)

logger = logging.getLogger(__name__)

router = APIRouter()

ALLOWED_EXTENSIONS = {"pdf", "docx", "doc", "md", "markdown", "txt", "text"}


def _get_user_id(token: Union[str, dict]) -> str:
    """Extract user_id from JWT token payload."""
    if isinstance(token, dict):
        uid = token.get("id") or token.get("user_id") or token.get("sub")
        if uid:
            return str(uid)
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User ID not found in token")


def _ensure_uuid(raw_id: str) -> str:
    """Ensure a raw user ID is valid UUID format; convert short IDs to deterministic UUID."""
    try:
        uuid.UUID(raw_id)
        return raw_id
    except (ValueError, AttributeError):
        return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"test-user-{raw_id}"))


async def _save_uploaded_file(file: UploadFile) -> str:
    """Save an uploaded file to disk and return the file path."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: .{ext}. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    upload_dir = os.path.join(settings.UPLOAD_DIR, "knowledge")
    os.makedirs(upload_dir, exist_ok=True)
    file_id = str(uuid.uuid4())
    file_path = os.path.join(upload_dir, f"{file_id}.{ext}")

    contents = await file.read()
    if len(contents) > settings.MAX_FILE_SIZE_MB * 1024 * 1024:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size: {settings.MAX_FILE_SIZE_MB}MB",
        )
    with open(file_path, "wb") as f:
        f.write(contents)
    return file_path


async def _create_kb_data_source(name: str, user_id: str, description: str = "") -> str:
    """Create a knowledge_base data source record and return its ID."""
    from src.modules.data.services.data_sources_crud import DataSourcesCRUD, DataSourceCreate
    from src.db.session import async_session

    crud = DataSourcesCRUD()
    create_data = DataSourceCreate(
        name=name,
        type="knowledge_base",
        format="knowledge_base",
        description=description or "Knowledge base for document retrieval",
        connection_config={},
        is_active=True,
    )
    async with async_session() as db:
        result = await crud.create_data_source(
            data_source_data=create_data,
            user_id=_ensure_uuid(user_id),
            session=db,
        )
    return str(result.id)


# ── Create Knowledge Base + Upload (single-call) ────────────────────────

class KnowledgeCreateResponse(BaseModel):
    success: bool
    data_source_id: str
    name: str
    documents: List[KnowledgeUploadResponse]


@router.post("/create", response_model=KnowledgeCreateResponse)
async def create_knowledge_base(
    name: str = Form(...),
    description: str = Form(""),
    files: List[UploadFile] = File(...),
    session: AsyncSession = Depends(get_async_session),
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """
    Create a knowledge base data source and upload documents in one call.
    Creates the data source, then ingests each file.
    """
    user_id = _get_user_id(current_token)
    await require_permission(user_id, "knowledge:create")

    if not files:
        raise HTTPException(status_code=400, detail="At least one file is required")

    # Create KB data source
    try:
        ds_id = await _create_kb_data_source(name, user_id, description)
    except Exception as exc:
        logger.exception("Failed to create KB data source")
        raise HTTPException(status_code=500, detail=f"Failed to create knowledge base: {str(exc)[:200]}")

    # Ingest each file
    from src.modules.knowledge.services.document_ingestion_service import DocumentIngestionService
    ingestion_service = DocumentIngestionService(session)
    results: List[KnowledgeUploadResponse] = []

    for file in files:
        try:
            file_path = await _save_uploaded_file(file)
            doc = await ingestion_service.ingest_document(
                file_path=file_path,
                data_source_id=ds_id,
                user_id=user_id,
                filename=file.filename or "unknown",
            )
            results.append(KnowledgeUploadResponse(
                success=doc.status == "ready",
                document_id=str(doc.id),
                filename=file.filename or "unknown",
                status=doc.status or "failed",
                message=f"Ingestion {'complete' if doc.status == 'ready' else doc.status}: {doc.chunk_count or 0} chunks",
            ))
        except Exception as exc:
            logger.warning("Ingestion failed for %s: %s", file.filename, exc)
            results.append(KnowledgeUploadResponse(
                success=False,
                document_id="",
                filename=file.filename or "unknown",
                status="failed",
                message=str(exc)[:200],
            ))

    return KnowledgeCreateResponse(
        success=any(r.success for r in results),
        data_source_id=ds_id,
        name=name,
        documents=results,
    )


# ── Upload to existing KB ────────────────────────────────────────────────

@router.post("/upload", response_model=KnowledgeUploadResponse)
async def upload_knowledge_document(
    file: UploadFile = File(...),
    data_source_id: str = Form(...),
    session: AsyncSession = Depends(get_async_session),
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """
    Upload a document (PDF, DOCX, MD, TXT) to an existing knowledge base.
    Triggers ingestion (chunking + embedding).
    """
    user_id = _get_user_id(current_token)
    await require_permission(user_id, "knowledge:create")
    file_path = await _save_uploaded_file(file)

    try:
        from src.modules.knowledge.services.document_ingestion_service import DocumentIngestionService

        service = DocumentIngestionService(session)
        doc = await service.ingest_document(
            file_path=file_path,
            data_source_id=data_source_id,
            user_id=user_id,
            filename=file.filename or "unknown",
        )

        return KnowledgeUploadResponse(
            success=doc.status == "ready",
            document_id=str(doc.id),
            filename=file.filename or "unknown",
            status=doc.status or "failed",
            message=f"Ingestion {'complete' if doc.status == 'ready' else doc.status}: {doc.chunk_count or 0} chunks",
        )
    except Exception as exc:
        logger.exception("Ingestion failed for %s", file.filename)
        raise HTTPException(status_code=500, detail=f"Ingestion failed: {str(exc)[:200]}")


# ── List Documents ───────────────────────────────────────────────────────

@router.get("/documents", response_model=List[KnowledgeDocumentOut])
async def list_knowledge_documents(
    data_source_id: Optional[str] = None,
    session: AsyncSession = Depends(get_async_session),
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """List knowledge documents, optionally filtered by data_source_id."""
    user_id = _get_user_id(current_token)
    stmt = select(KnowledgeDocument).where(KnowledgeDocument.user_id == user_id)
    if data_source_id:
        stmt = stmt.where(KnowledgeDocument.data_source_id == data_source_id)
    stmt = stmt.order_by(KnowledgeDocument.created_at.desc())

    result = await session.execute(stmt)
    docs = result.scalars().all()

    return [
        KnowledgeDocumentOut(
            id=str(d.id),
            data_source_id=d.data_source_id,
            filename=d.filename,
            file_type=d.file_type,
            chunk_count=d.chunk_count or 0,
            status=d.status or "unknown",
            error_message=d.error_message,
            metadata=d.doc_metadata,
            created_at=d.created_at,
            updated_at=d.updated_at,
        )
        for d in docs
    ]


# ── Document Detail ──────────────────────────────────────────────────────

@router.get("/documents/{doc_id}", response_model=KnowledgeDocumentOut)
async def get_knowledge_document(
    doc_id: str,
    session: AsyncSession = Depends(get_async_session),
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """Get details of a specific knowledge document."""
    user_id = _get_user_id(current_token)
    stmt = select(KnowledgeDocument).where(
        KnowledgeDocument.id == doc_id,
        KnowledgeDocument.user_id == user_id,
    )
    result = await session.execute(stmt)
    doc = result.scalar_one_or_none()

    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    return KnowledgeDocumentOut(
        id=str(doc.id),
        data_source_id=doc.data_source_id,
        filename=doc.filename,
        file_type=doc.file_type,
        chunk_count=doc.chunk_count or 0,
        status=doc.status or "unknown",
        error_message=doc.error_message,
        metadata=doc.doc_metadata,
        created_at=doc.created_at,
        updated_at=doc.updated_at,
    )


# ── Update Document (rename / metadata) ──────────────────────────────────

@router.patch("/documents/{doc_id}", response_model=KnowledgeDocumentOut)
async def update_knowledge_document(
    doc_id: str,
    payload: KnowledgeDocumentUpdate,
    session: AsyncSession = Depends(get_async_session),
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """Rename a document or update metadata (no re-ingest)."""
    user_id = _get_user_id(current_token)
    await require_permission(user_id, "knowledge:create")

    stmt = select(KnowledgeDocument).where(
        KnowledgeDocument.id == doc_id,
        KnowledgeDocument.user_id == user_id,
    )
    result = await session.execute(stmt)
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    data = payload.model_dump(exclude_unset=True)
    if "filename" in data and data["filename"]:
        doc.filename = str(data["filename"]).strip() or doc.filename

    meta = dict(doc.doc_metadata or {}) if isinstance(doc.doc_metadata, dict) else {}
    if "description" in data:
        desc = data.get("description")
        if desc is None or str(desc).strip() == "":
            meta.pop("description", None)
        else:
            meta["description"] = str(desc).strip()
    if "metadata" in data and isinstance(data.get("metadata"), dict):
        meta.update(data["metadata"])
    doc.doc_metadata = meta

    await session.commit()
    await session.refresh(doc)

    return KnowledgeDocumentOut(
        id=str(doc.id),
        data_source_id=doc.data_source_id,
        filename=doc.filename,
        file_type=doc.file_type,
        chunk_count=doc.chunk_count or 0,
        status=doc.status or "unknown",
        error_message=doc.error_message,
        metadata=doc.doc_metadata,
        created_at=doc.created_at,
        updated_at=doc.updated_at,
    )


# ── Delete Document ──────────────────────────────────────────────────────

@router.delete("/documents/{doc_id}")
async def delete_knowledge_document(
    doc_id: str,
    session: AsyncSession = Depends(get_async_session),
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """Delete a knowledge document and all its chunks."""
    user_id = _get_user_id(current_token)
    await require_permission(user_id, "knowledge:delete")

    stmt = select(KnowledgeDocument).where(
        KnowledgeDocument.id == doc_id,
        KnowledgeDocument.user_id == user_id,
    )
    result = await session.execute(stmt)
    doc = result.scalar_one_or_none()

    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Delete chunks first (CASCADE should handle this, but explicit is safer)
    await session.execute(
        delete(DocumentChunk).where(DocumentChunk.document_id == doc.id)
    )
    await session.delete(doc)
    await session.commit()

    return {"success": True, "message": f"Document '{doc.filename}' and its chunks deleted"}


# ── Semantic Search ──────────────────────────────────────────────────────

@router.post("/search", response_model=KnowledgeSearchResponse)
async def search_knowledge_base(
    request: KnowledgeSearchRequest,
    session: AsyncSession = Depends(get_async_session),
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """
    Direct semantic search over the knowledge base.
    Useful for testing retrieval quality and advanced use cases.
    """
    user_id = _get_user_id(current_token)
    await require_permission(user_id, "knowledge:search")

    from src.modules.knowledge.services.rag_retrieval_service import RAGRetrievalService

    service = RAGRetrievalService(session)
    chunks = await service.retrieve(
        query=request.query,
        data_source_id=request.data_source_id,
        top_k=request.top_k,
    )

    return KnowledgeSearchResponse(
        success=True,
        query=request.query,
        results=[
            RetrievedChunkOut(
                chunk_id=c.chunk_id,
                document_id=c.document_id,
                content=c.content,
                score=c.score,
                metadata=c.metadata,
                document_filename=c.document_filename,
            )
            for c in chunks
        ],
        total=len(chunks),
    )


@router.get("/health/retrieval")
async def knowledge_retrieval_health(
    session: AsyncSession = Depends(get_async_session),
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """Health check for RAG retrieval backend (pgvector vs JSONB) and probe latency."""
    user_id = _get_user_id(current_token)
    await require_permission(user_id, "knowledge:view")

    from src.modules.knowledge.services.rag_retrieval_service import RAGRetrievalService

    service = RAGRetrievalService(session)
    report = await service.retrieval_health()
    return {"success": True, **report}
