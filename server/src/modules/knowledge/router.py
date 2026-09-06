"""
Knowledge Base REST API — upload, list, detail, delete, and search endpoints.

Mounted at /knowledge prefix in the main API router.
"""

import logging
import uuid
from typing import List, Optional, Union

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
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


# file_type (as tracked on KnowledgeDocument.file_type / detected by
# DocumentIngestionService._detect_file_type) -> a real Content-Type for the
# download endpoint's response. Falls back to octet-stream for anything not
# listed (shouldn't happen given ALLOWED_EXTENSIONS, but a wrong-but-valid
# fallback beats a crash).
_FILE_TYPE_CONTENT_TYPES = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "md": "text/markdown",
    "txt": "text/plain",
}


async def _store_uploaded_file(file: UploadFile, data_source_id: str, project_id: Optional[str], user_id: str) -> str:
    """
    Validate and durably store an uploaded file's bytes via
    UploadDatasourceStorageService -- the same S3/Azure Blob/PostgreSQL-backed
    object storage CSV/datasource uploads already use (selected via
    STORAGE_BACKEND; see upload_datasource_storage_service.py). Returns the
    resulting object_key.

    Replaces the prior behavior of writing straight to a local UPLOAD_DIR
    path (a Docker volume, not S3-compatible/horizontally scalable) that was
    also never cleaned up afterward -- a pure disk leak, since nothing ever
    re-referenced that path once ingestion had read it once.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: .{ext}. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    contents = await file.read()
    if len(contents) > settings.MAX_FILE_SIZE_MB * 1024 * 1024:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size: {settings.MAX_FILE_SIZE_MB}MB",
        )

    from src.modules.data.services.upload_datasource_storage_service import UploadDatasourceStorageService

    storage_service = UploadDatasourceStorageService()
    object_key = await storage_service.store_file(
        file_content=contents,
        project_id=project_id,
        original_filename=file.filename,
        content_type=file.content_type or _FILE_TYPE_CONTENT_TYPES.get(ext, "application/octet-stream"),
        source_id=data_source_id,
        user_id=user_id,
    )
    logger.info(
        "Stored KB upload %s in %s: %s", file.filename, storage_service.storage_type, object_key,
    )
    return object_key


async def _resolve_data_source_project_id(data_source_id: str, session: AsyncSession) -> Optional[str]:
    """Resolve a data source's project_id so KB file storage/retrieval is
    scoped consistently with how CSV/datasource uploads scope object storage
    keys (see UploadDatasourceStorageService.store_file's project_id param).
    Best-effort: returns None (CE-style unscoped storage) on any lookup
    failure rather than blocking upload/download."""
    try:
        from src.modules.data.models import DataSource

        result = await session.execute(select(DataSource.project_id).where(DataSource.id == data_source_id))
        row = result.first()
        return str(row[0]) if row and row[0] else None
    except Exception:
        logger.debug("Failed to resolve project_id for data source %s", data_source_id, exc_info=True)
        return None


async def _create_pending_document(
    session: AsyncSession,
    data_source_id: str,
    user_id: str,
    filename: str,
    object_key: str,
) -> KnowledgeDocument:
    """
    Create the KnowledgeDocument row up front with status="processing"
    before handing ingestion off to a background job, so the HTTP response
    can return a real document id/status immediately instead of blocking on
    parse+chunk+embed (which, for a normal multi-page PDF chunked at
    CHUNK_TARGET_TOKENS=600 tokens/chunk, can take real CPU time on a local
    embedding model with no GPU -- risking reverse-proxy/client timeouts).

    DocumentIngestionService.ingest_document() (run later, in the background
    job) is passed this same document id and reuses/updates this row rather
    than creating a second one -- see its `document_id` param.
    """
    from src.modules.knowledge.services.document_ingestion_service import DocumentIngestionService

    doc = KnowledgeDocument(
        id=uuid.uuid4(),
        data_source_id=data_source_id,
        user_id=user_id,
        filename=filename,
        file_type=DocumentIngestionService._detect_file_type(filename),
        object_key=object_key,
        status="processing",
    )
    session.add(doc)
    await session.commit()
    await session.refresh(doc)
    return doc


async def _create_kb_data_source(
    name: str, user_id: str, description: str = "", project_id: Optional[str] = None
) -> str:
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
        project_id=project_id,
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
    project_id: Optional[str] = Form(None),
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
        ds_id = await _create_kb_data_source(name, user_id, description, project_id=project_id)
    except Exception as exc:
        logger.exception("Failed to create KB data source")
        raise HTTPException(status_code=500, detail=f"Failed to create knowledge base: {str(exc)[:200]}")

    # This CE flow predates /knowledge's Library wrapper and (being CE) can't
    # import the EE module that owns it directly — without this, the data source
    # works fine everywhere else (chat, /data) but silently never appears on
    # /knowledge, since that page lists Libraries, not raw data sources.
    from src.core.edition import is_ee_enabled

    if is_ee_enabled():
        try:
            import importlib

            _lib_service = importlib.import_module("ee.modules.knowledge.library_service")
            await _lib_service.KnowledgeLibraryService.ensure_library_for_data_source(ds_id, user_id)
        except Exception:
            logger.warning("Knowledge library wrapper creation skipped for %s", ds_id, exc_info=True)

    # Store each file durably, create a "processing" placeholder row, and
    # enqueue background ingestion -- parse+chunk+embed no longer happens
    # inline in this request (see ingest_knowledge_document in
    # src/shared/jobs/tasks.py); the response returns immediately with each
    # document in "processing" state.
    from src.shared.jobs.client import enqueue_job

    results: List[KnowledgeUploadResponse] = []

    for file in files:
        try:
            object_key = await _store_uploaded_file(file, ds_id, project_id, user_id)
            doc = await _create_pending_document(
                session, ds_id, user_id, file.filename or "unknown", object_key,
            )
            await enqueue_job(
                "ingest_knowledge_document",
                document_id=str(doc.id),
                object_key=object_key,
                data_source_id=ds_id,
                user_id=user_id,
                filename=file.filename or "unknown",
                project_id=project_id,
            )
            results.append(KnowledgeUploadResponse(
                success=True,
                document_id=str(doc.id),
                filename=file.filename or "unknown",
                status=doc.status or "processing",
                message="Ingestion started",
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

    project_id = await _resolve_data_source_project_id(data_source_id, session)
    object_key = await _store_uploaded_file(file, data_source_id, project_id, user_id)

    try:
        from src.shared.jobs.client import enqueue_job

        doc = await _create_pending_document(
            session, data_source_id, user_id, file.filename or "unknown", object_key,
        )
        await enqueue_job(
            "ingest_knowledge_document",
            document_id=str(doc.id),
            object_key=object_key,
            data_source_id=data_source_id,
            user_id=user_id,
            filename=file.filename or "unknown",
            project_id=project_id,
        )

        return KnowledgeUploadResponse(
            success=True,
            document_id=str(doc.id),
            filename=file.filename or "unknown",
            status=doc.status or "processing",
            message="Ingestion started",
        )
    except Exception as exc:
        logger.exception("Failed to start ingestion for %s", file.filename)
        raise HTTPException(status_code=500, detail=f"Failed to start ingestion: {str(exc)[:200]}")


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


# ── Download Original File ───────────────────────────────────────────────

@router.get("/documents/{doc_id}/download")
async def download_knowledge_document(
    doc_id: str,
    session: AsyncSession = Depends(get_async_session),
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """
    Stream the original uploaded file back for a knowledge document.

    Read-scoped ("knowledge:view", same permission knowledge_retrieval_health
    uses -- not "knowledge:create") plus the same ownership filter
    get_knowledge_document above uses.

    Documents ingested before object_key existed (see the
    2026_09_02_knowledge_doc_object_key migration) have no durably-stored
    original to serve -- their upload-time file was written to local disk,
    read once by the parser, and never persisted anywhere retrievable. That
    is a 404, not a crash.
    """
    user_id = _get_user_id(current_token)
    await require_permission(user_id, "knowledge:view")

    stmt = select(KnowledgeDocument).where(
        KnowledgeDocument.id == doc_id,
        KnowledgeDocument.user_id == user_id,
    )
    result = await session.execute(stmt)
    doc = result.scalar_one_or_none()

    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if not doc.object_key:
        raise HTTPException(
            status_code=404,
            detail="Original file not available for this document (uploaded before durable storage was added)",
        )

    from src.modules.data.services.upload_datasource_storage_service import UploadDatasourceStorageService

    project_id = await _resolve_data_source_project_id(doc.data_source_id, session)
    storage_service = UploadDatasourceStorageService()
    try:
        content = await storage_service.get_file(doc.object_key, project_id)
    except Exception:
        logger.exception("Failed to retrieve stored file for document %s (object_key=%s)", doc_id, doc.object_key)
        raise HTTPException(status_code=404, detail="Original file could not be retrieved from storage")

    import io

    content_type = _FILE_TYPE_CONTENT_TYPES.get(doc.file_type or "", "application/octet-stream")
    filename = doc.filename or f"document.{doc.file_type or 'bin'}"
    safe_filename = filename.replace('"', "'")

    return StreamingResponse(
        io.BytesIO(content),
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{safe_filename}"'},
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

    # SECURITY: the permission check above is global ("can this user search
    # *some* knowledge base"), not scoped to request.data_source_id -- any
    # authenticated user who obtained another org's KB data_source_id
    # (visible in URLs, other API responses, etc.) could retrieve its private
    # document search results. Require an explicit grant on that specific
    # data source, same primitive src/modules/data/router.py uses to gate
    # per-source access elsewhere.
    if request.data_source_id:
        from src.modules.data.services.data_source_access_service import DataSourceAccessService

        allowed = await DataSourceAccessService.can_access(
            user_id, request.data_source_id, "data:view", session=session
        )
        if not allowed:
            raise HTTPException(status_code=403, detail="Not authorized to access this data source")

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
