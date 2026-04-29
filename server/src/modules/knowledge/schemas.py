"""Pydantic schemas for Knowledge RAG module."""

from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class KnowledgeUploadResponse(BaseModel):
    success: bool
    document_id: str
    filename: str
    status: str
    message: str = "Ingestion started"


class KnowledgeSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)
    data_source_id: str
    top_k: int = Field(default=5, ge=1, le=20)


class KnowledgeDocumentOut(BaseModel):
    id: str
    data_source_id: str
    filename: str
    file_type: Optional[str] = None
    chunk_count: int = 0
    status: str = "processing"
    error_message: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class RetrievedChunkOut(BaseModel):
    chunk_id: str
    document_id: str
    content: str
    score: float
    metadata: Optional[Dict[str, Any]] = None
    document_filename: Optional[str] = None


class KnowledgeSearchResponse(BaseModel):
    success: bool
    query: str
    results: List[RetrievedChunkOut]
    total: int


class CitationOut(BaseModel):
    source: str
    document_id: Optional[str] = None
    chunk_id: Optional[str] = None
    relevance_score: Optional[float] = None
    excerpt: Optional[str] = None
