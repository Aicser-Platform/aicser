"""
Data Connectivity Models
Database models for data sources, project data sources, file storage,
connector runtime jobs, and query history.
"""
from sqlalchemy import (
    Column, String, Integer, DateTime, Text, JSON, Boolean, ForeignKey,
)
from sqlalchemy.dialects.postgresql import BYTEA, JSONB, UUID
from sqlalchemy.sql import func, text

from src.core.edition import is_ee_enabled
from src.db.base import Base

def _project_fk():
    return [ForeignKey("projects.id")] if is_ee_enabled() else []


class DataSource(Base):
    """
    Data source model matching exact database schema.
    Table: data_sources
    Schema: id (UUID), name, type, format, db_type, size, row_count, schema (JSON),
            sample_data (JSON), description, connection_config (JSON), file_path,
            original_filename, created_at, updated_at, user_id, is_active, last_accessed
    Note: Does not inherit from BaseModel because data_sources table doesn't have
          deleted_at or is_deleted columns in the database schema.
    """
    __tablename__ = "data_sources"

    id = Column(String, primary_key=True, index=True)

    name = Column(String, nullable=False)
    type = Column(String, nullable=False)  # 'file' or 'database'
    format = Column(String, nullable=True)  # For file sources: 'csv', 'xlsx', etc.
    db_type = Column(String, nullable=True)  # For database sources: 'postgresql', 'mysql', etc.

    # Metadata
    size = Column(Integer, nullable=True)  # File size in bytes
    row_count = Column(Integer, nullable=True)
    schema = Column(JSON, nullable=True)  # Schema information
    sample_data = Column(JSON, nullable=True)  # Optional in-memory sample rows
    description = Column(Text, nullable=True)

    # Connection details (encrypted in production)
    connection_config = Column(JSON, nullable=True)

    # File details
    file_path = Column(String, nullable=True)
    original_filename = Column(String, nullable=True)

    # Timestamps (TIMESTAMP WITH TIME ZONE)
    created_at = Column(DateTime(timezone=True), nullable=True, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=True, onupdate=func.now())

    # User ownership — tracks who uploaded/created this data source (nullable for backward compat)
    user_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    project_id = Column(UUID(as_uuid=True), *_project_fk(), nullable=True)

    # Tenant isolation (nullable; DB default 'default' so INSERTs without it succeed)
    tenant_id = Column(String, nullable=True, server_default=text("'default'"))

    # Status (nullable in DB)
    is_active = Column(Boolean, nullable=True, server_default=text("true"))
    last_accessed = Column(DateTime(timezone=True), nullable=True)


class DataModelRelationship(Base):
    """
    Join relationships between tables for a data source (semantic / dashboard joins).
    Table: data_model_relationships
    """
    __tablename__ = "data_model_relationships"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid(), index=True)
    data_source_id = Column(String, ForeignKey("data_sources.id", ondelete="CASCADE"), nullable=False, index=True)
    from_table = Column(String, nullable=False)
    from_column = Column(String, nullable=False)
    to_table = Column(String, nullable=False)
    to_column = Column(String, nullable=False)
    join_type = Column(String, nullable=False, server_default=text("'LEFT'"))
    created_at = Column(DateTime(timezone=True), nullable=True, server_default=func.now())


class ProjectDataSource(Base):
    """
    Many-to-many link between projects and data sources.
    Table: project_data_source (matches setup_database / seed_database).
    RBAC and data_connectivity_service use this for project-scoped data source access.
    """
    __tablename__ = "project_data_source"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid(), index=True)
    project_id = Column(UUID(as_uuid=True), *_project_fk(), nullable=True, index=True)
    data_source_id = Column(String, nullable=False, index=True)
    data_source_type = Column(String, nullable=False)
    is_active = Column(Boolean, nullable=True, server_default=text("true"))
    added_at = Column(DateTime(timezone=True), nullable=True, server_default=func.now())


class FileStorage(Base):
    """
    File storage model matching exact database schema.
    Table: file_storage
    Schema: object_key (VARCHAR PK), file_data (BYTEA), file_size, content_type,
            original_filename, user_id, created_at, updated_at, is_active
    Note: Does not inherit from BaseModel because object_key is the primary key, not id.
    """
    __tablename__ = "file_storage"

    # Primary key is object_key, not id
    object_key = Column(String, primary_key=True, index=True)

    # Binary data
    file_data = Column(BYTEA, nullable=False)  # PostgreSQL BYTEA type

    # Metadata
    file_size = Column(Integer, nullable=False)
    content_type = Column(String, nullable=True)
    original_filename = Column(String, nullable=True)

    # Ownership (UUID, NOT NULL in DB)
    # user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    project_id = Column(UUID(as_uuid=True), *_project_fk(), nullable=True)
    # Timestamps (TIMESTAMP WITH TIME ZONE)
    created_at = Column(DateTime(timezone=True), nullable=True, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=True, server_default=func.now(), onupdate=func.now())

    # Soft delete (nullable in DB)
    is_active = Column(Boolean, nullable=True, server_default=text("true"))


class ConnectorRuntimeJob(Base):
    """
    Stub job table for Agent Data Fabric connector runtime (batch/CDC/direct).
    Table: connector_runtime_jobs
    """
    __tablename__ = "connector_runtime_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid(), index=True)
    project_id = Column(UUID(as_uuid=True), *_project_fk(), nullable=True, index=True)
    connector_mode = Column(String(32), nullable=False, index=True)
    status = Column(String(32), nullable=False, server_default=text("'pending'"))
    config = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class DataQuery(Base):
    """Data query model for storing query history"""

    __tablename__ = "data_queries"

    id = Column(String, primary_key=True, index=True)
    data_source_id = Column(String, nullable=False)

    # Query details
    natural_language_query = Column(Text, nullable=True)
    query_config = Column(JSON, nullable=True)  # Filters, sorting, etc.

    # Results
    result_count = Column(Integer, nullable=True)
    execution_time_ms = Column(Integer, nullable=True)

    # Analytics
    query_type = Column(JSON, nullable=True)  # ['trends', 'comparisons', etc.]
    business_context = Column(JSON, nullable=True)

    # Chart generation
    chart_type = Column(String, nullable=True)
    chart_config = Column(JSON, nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # User ownership (required for security and data isolation)
    user_id = Column(String, nullable=False, index=True)
