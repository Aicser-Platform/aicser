"""Knowledge / RAG domain SQLAlchemy models."""
from sqlalchemy import (
    Column, String, Integer, BigInteger, DateTime, Text, ForeignKey,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.sql import func, text

from src.db.base import Base


class KnowledgeDocument(Base):
    """
    Knowledge document metadata for RAG (Retrieval-Augmented Generation).
    Table: knowledge_documents

    Tracks uploaded documents (PDF, DOCX, MD, TXT) that are chunked and
    embedded for semantic retrieval during AI-powered analysis.
    """
    __tablename__ = "knowledge_documents"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid(), index=True)
    data_source_id = Column(String, ForeignKey("data_sources.id"), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    filename = Column(String, nullable=False)
    file_type = Column(String(10), nullable=True)  # pdf, md, txt, docx
    chunk_count = Column(Integer, nullable=True, server_default=text("0"))
    status = Column(String(20), nullable=True, server_default=text("'processing'"))  # processing, ready, failed
    error_message = Column(Text, nullable=True)
    doc_metadata = Column("metadata", JSONB, nullable=True)  # page_count, word_count, etc.

    created_at = Column(DateTime(timezone=True), nullable=True, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=True, server_default=func.now(), onupdate=func.now())


class DocumentChunk(Base):
    """
    Individual text chunks from knowledge documents, with embeddings for
    hybrid (semantic + keyword) retrieval.
    Table: document_chunks
    """
    __tablename__ = "document_chunks"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid(), index=True)
    document_id = Column(UUID(as_uuid=True), ForeignKey("knowledge_documents.id", ondelete="CASCADE"), nullable=False, index=True)
    data_source_id = Column(String, nullable=False, index=True)
    chunk_index = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)
    token_count = Column(Integer, nullable=True)
    embedding = Column(JSONB, nullable=True)  # JSONB list of floats (pgvector migration optional)
    chunk_metadata = Column("metadata", JSONB, nullable=True)  # page_number, section_title, heading, etc.

    created_at = Column(DateTime(timezone=True), nullable=True, server_default=func.now())


class SchemaTableIndex(Base):
    """
    Table-level schema index for Schema RAG: one row per table per data source.
    Embedding is built from table_name + column names + types + descriptions.

    domain_tag: Business domain cluster assigned at index time (Finance, Sales, Product, Ops…).
    Used by the domain router to narrow candidates from 50K+ tables to a small domain set
    before the semantic ranker, making Schema RAG feasible at enterprise scale.
    Migration: alembic revision --autogenerate -m "add schema_table_index.domain_tag"
    """
    __tablename__ = "schema_table_index"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid(), index=True)
    data_source_id = Column(String, nullable=False, index=True)
    table_name = Column(String(255), nullable=False, index=True)
    schema_name = Column(String(255), nullable=True)
    column_names_json = Column(JSONB, nullable=True)
    column_types_json = Column(JSONB, nullable=True)
    description = Column(Text, nullable=True)
    row_count = Column(BigInteger, nullable=True)
    embedding = Column(JSONB, nullable=True)
    # Domain cluster for two-stage retrieval (schema scale: 10K+ tables)
    domain_tag = Column(String(64), nullable=True, index=True)
    updated_at = Column(DateTime(timezone=True), nullable=True, server_default=func.now())


class SchemaColumnIndex(Base):
    """
    Column-level schema index for Schema RAG (optional, for very large schemas).
    One row per column per table per data source.
    """
    __tablename__ = "schema_column_index"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid(), index=True)
    data_source_id = Column(String, nullable=False, index=True)
    table_name = Column(String(255), nullable=False, index=True)
    column_name = Column(String(255), nullable=False, index=True)
    data_type = Column(String(64), nullable=True)
    description = Column(Text, nullable=True)
    embedding = Column(JSONB, nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=True, server_default=func.now())
