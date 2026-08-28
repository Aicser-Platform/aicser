"""
Data Connectivity Models
Database models for data sources, project data sources, file storage,
connector runtime jobs, and query history.
"""
from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import BYTEA, JSONB, UUID
from sqlalchemy.sql import func, text

from src.core.edition import is_ee_enabled
from src.db.base import Base, BaseModel


def _project_fk():
    return [ForeignKey("projects.id")] if is_ee_enabled() else []


def _organization_fk():
    return [ForeignKey("organizations.id")] if is_ee_enabled() else []


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
    db_type = Column(
        String, nullable=True
    )  # For database sources: 'postgresql', 'mysql', etc.

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
    created_at = Column(
        DateTime(timezone=True), nullable=True, server_default=func.now()
    )
    updated_at = Column(DateTime(timezone=True), nullable=True, onupdate=func.now())

    # User ownership tracks who uploaded/created this data source.
    user_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    project_id = Column(UUID(as_uuid=True), *_project_fk(), nullable=True)
    organization_id = Column(
        UUID(as_uuid=True), *_organization_fk(), nullable=True, index=True
    )

    # Tenant isolation (nullable; DB default 'default' so INSERTs without it succeed)
    tenant_id = Column(String, nullable=True, server_default=text("'default'"))

    # Status (nullable in DB)
    is_active = Column(Boolean, nullable=True, server_default=text("true"))
    last_accessed = Column(DateTime(timezone=True), nullable=True)


class DataSourceRLSPolicy(BaseModel):
    """
    First-class row-level security policy for an organization-owned data source.

    Policies are separate from connection_config so access rules can be audited,
    granted, and resolved consistently across SQL editor, dashboards, AI, and ETL.
    """

    __tablename__ = "data_source_rls_policies"

    organization_id = Column(
        UUID(as_uuid=True), *_organization_fk(), nullable=True, index=True
    )
    data_source_id = Column(
        String,
        ForeignKey("data_sources.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    enabled = Column(Boolean, nullable=False, server_default=text("true"))
    default_deny = Column(Boolean, nullable=False, server_default=text("true"))
    settings = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_by = Column(UUID(as_uuid=True), nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "data_source_id", "name", name="uq_data_source_rls_policy_name"
        ),
        Index(
            "ix_data_source_rls_policies_source_enabled", "data_source_id", "enabled"
        ),
    )


class DataSourceRLSRule(BaseModel):
    """A single table/column predicate belonging to a data-source RLS policy."""

    __tablename__ = "data_source_rls_rules"

    policy_id = Column(
        UUID(as_uuid=True),
        ForeignKey("data_source_rls_policies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    table_name = Column(String(255), nullable=False)
    column_name = Column(String(255), nullable=False)
    operator = Column(
        Enum(
            "eq",
            "in",
            "not_in",
            "between",
            "is_null",
            "is_not_null",
            name="data_source_rls_operator_enum",
        ),
        nullable=False,
    )
    value_type = Column(
        Enum(
            "fixed",
            "user_attribute",
            "group_attribute",
            "org_attribute",
            "project_attribute",
            name="data_source_rls_value_type_enum",
        ),
        nullable=False,
    )
    value = Column(JSONB, nullable=True)
    sort_order = Column(Integer, nullable=False, server_default=text("0"))

    __table_args__ = (
        Index("ix_data_source_rls_rules_policy_table", "policy_id", "table_name"),
    )


class DataSourceCLSPolicy(BaseModel):
    """Column-level policy: which columns a grantee may read, and how.

    Separate from DataSourceRLSPolicy so one column policy ("mask PII") can be
    paired with many different row policies instead of being duplicated into
    each one.
    """

    __tablename__ = "data_source_cls_policies"

    organization_id = Column(
        UUID(as_uuid=True), *_organization_fk(), nullable=True, index=True
    )
    data_source_id = Column(
        String,
        ForeignKey("data_sources.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    enabled = Column(Boolean, nullable=False, server_default=text("true"))
    settings = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_by = Column(UUID(as_uuid=True), nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "data_source_id", "name", name="uq_data_source_cls_policy_name"
        ),
        Index(
            "ix_data_source_cls_policies_source_enabled", "data_source_id", "enabled"
        ),
    )


class DataSourceCLSRule(BaseModel):
    """One column's treatment under a column policy."""

    __tablename__ = "data_source_cls_rules"

    policy_id = Column(
        UUID(as_uuid=True),
        ForeignKey("data_source_cls_policies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    table_name = Column(String(255), nullable=False)
    column_name = Column(String(255), nullable=False)
    action = Column(
        Enum("deny", "mask", name="data_source_cls_action_enum"),
        nullable=False,
    )
    mask_strategy = Column(
        Enum("fixed", "partial", "hash", "null", name="data_source_cls_mask_enum"),
        nullable=True,
    )
    mask_config = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    sort_order = Column(Integer, nullable=False, server_default=text("0"))


class DataSourceAccessGrant(BaseModel):
    """Explicit grant allowing a user, group, role, or project to use a data source."""

    __tablename__ = "data_source_access_grants"

    organization_id = Column(
        UUID(as_uuid=True), *_organization_fk(), nullable=True, index=True
    )
    data_source_id = Column(
        String,
        ForeignKey("data_sources.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    grantee_type = Column(
        Enum(
            "project",
            "user",
            "group",
            "org_role",
            "project_role",
            name="data_source_grantee_type_enum",
        ),
        nullable=False,
    )
    grantee_id = Column(String(255), nullable=False, index=True)
    permissions = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    rls_policy_id = Column(
        UUID(as_uuid=True),
        ForeignKey("data_source_rls_policies.id", ondelete="SET NULL"),
        nullable=True,
    )
    cls_policy_id = Column(
        UUID(as_uuid=True),
        ForeignKey("data_source_cls_policies.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_by = Column(UUID(as_uuid=True), nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "data_source_id",
            "grantee_type",
            "grantee_id",
            name="uq_data_source_access_grant_grantee",
        ),
        Index(
            "ix_data_source_access_grants_org_grantee",
            "organization_id",
            "grantee_type",
            "grantee_id",
        ),
    )


class DataLakeObject(BaseModel):
    """Versioned S3/object-storage artifact for Bronze/Silver/Gold data."""

    __tablename__ = "data_lake_objects"

    organization_id = Column(
        UUID(as_uuid=True), *_organization_fk(), nullable=True, index=True
    )
    data_source_id = Column(
        String,
        ForeignKey("data_sources.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    layer = Column(
        Enum("staging", "bronze", "silver", "gold", name="data_lake_layer_enum"),
        nullable=False,
        index=True,
    )
    object_key = Column(Text, nullable=False)
    storage_uri = Column(Text, nullable=True)
    format = Column(String(50), nullable=False, server_default=text("'parquet'"))
    version = Column(String(100), nullable=False)
    schema_snapshot = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    partition_values = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    checksum = Column(String(128), nullable=True)
    row_count = Column(Integer, nullable=True)
    byte_size = Column(Integer, nullable=True)
    status = Column(
        Enum(
            "active",
            "superseded",
            "quarantined",
            "deleted",
            name="data_lake_object_status_enum",
        ),
        nullable=False,
        server_default=text("'active'"),
        index=True,
    )
    created_by_job_id = Column(UUID(as_uuid=True), nullable=True, index=True)

    __table_args__ = (
        UniqueConstraint("object_key", "version", name="uq_data_lake_object_version"),
        Index("ix_data_lake_objects_source_layer", "data_source_id", "layer"),
    )


class DataIngestionJob(BaseModel):
    """Scheduled or on-demand load into a lakehouse layer."""

    __tablename__ = "data_ingestion_jobs"

    organization_id = Column(
        UUID(as_uuid=True), *_organization_fk(), nullable=True, index=True
    )
    project_id = Column(UUID(as_uuid=True), *_project_fk(), nullable=True, index=True)
    data_source_id = Column(
        String,
        ForeignKey("data_sources.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    pipeline_id = Column(
        UUID(as_uuid=True),
        ForeignKey("data_pipelines.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    source_kind = Column(
        Enum("file", "database", "api", "cdc", name="data_ingestion_source_kind_enum"),
        nullable=False,
    )
    mode = Column(
        Enum("snapshot", "incremental", "cdc", name="data_ingestion_mode_enum"),
        nullable=False,
    )
    target_layer = Column(
        Enum("bronze", "silver", "gold", name="data_ingestion_target_layer_enum"),
        nullable=False,
        server_default=text("'bronze'"),
    )
    status = Column(
        Enum(
            "queued",
            "running",
            "succeeded",
            "failed",
            "cancelled",
            name="data_ingestion_status_enum",
        ),
        nullable=False,
        server_default=text("'queued'"),
        index=True,
    )
    schedule_cron = Column(String(120), nullable=True)
    source_snapshot = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    options = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    checkpoint = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    output_object_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    rows_read = Column(Integer, nullable=True)
    rows_written = Column(Integer, nullable=True)
    bytes_written = Column(Integer, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    error_code = Column(String(100), nullable=True)
    error_message = Column(Text, nullable=True)
    created_by = Column(UUID(as_uuid=True), nullable=True)

    __table_args__ = (
        Index("ix_data_ingestion_jobs_source_status", "data_source_id", "status"),
    )


class DataCDCState(BaseModel):
    """Persistent checkpoint/watermark for CDC-capable sources."""

    __tablename__ = "data_cdc_states"

    organization_id = Column(
        UUID(as_uuid=True), *_organization_fk(), nullable=True, index=True
    )
    data_source_id = Column(
        String,
        ForeignKey("data_sources.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    connector = Column(String(100), nullable=False)
    stream_name = Column(String(255), nullable=False)
    checkpoint = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    high_watermark = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    lag_seconds = Column(Integer, nullable=True)
    last_event_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "data_source_id",
            "connector",
            "stream_name",
            name="uq_data_cdc_state_stream",
        ),
    )


class SemanticLayerArtifact(BaseModel):
    """Versioned semantic model artifact stored in object storage."""

    __tablename__ = "semantic_layer_artifacts"

    organization_id = Column(
        UUID(as_uuid=True), *_organization_fk(), nullable=True, index=True
    )
    project_id = Column(UUID(as_uuid=True), *_project_fk(), nullable=True, index=True)
    data_source_id = Column(
        String,
        ForeignKey("data_sources.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    name = Column(String(200), nullable=False)
    version = Column(String(100), nullable=False)
    object_key = Column(Text, nullable=False)
    storage_uri = Column(Text, nullable=True)
    format = Column(String(50), nullable=False, server_default=text("'yaml'"))
    model_snapshot = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    status = Column(
        Enum(
            "draft", "published", "archived", name="semantic_layer_artifact_status_enum"
        ),
        nullable=False,
        server_default=text("'draft'"),
    )
    created_by = Column(UUID(as_uuid=True), nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "data_source_id",
            "name",
            "version",
            name="uq_semantic_layer_artifact_version",
        ),
        Index("ix_semantic_layer_artifacts_source_status", "data_source_id", "status"),
    )


class DataPipeline(BaseModel):
    """Pipeline definition. Runs are recorded in data_ingestion_jobs."""

    __tablename__ = "data_pipelines"

    organization_id = Column(
        UUID(as_uuid=True), *_organization_fk(), nullable=True, index=True
    )
    name = Column(String(200), nullable=False)
    slug = Column(String(200), nullable=False)
    # Discriminated reference — deliberately not a polymorphic FK.
    source_asset_type = Column(
        Enum("data_source", "lake_object", name="data_pipeline_source_asset_type_enum"),
        nullable=False,
    )
    source_asset_id = Column(String, nullable=False, index=True)
    target_layer = Column(
        Enum("silver", "gold", name="data_pipeline_target_layer_enum"),
        nullable=False,
        server_default=text("'silver'"),
    )
    ingest_mode = Column(
        Enum("snapshot", "incremental", "cdc", name="data_pipeline_ingest_mode_enum"),
        nullable=False,
        server_default=text("'snapshot'"),
    )
    yaml_artifact_id = Column(
        UUID(as_uuid=True),
        ForeignKey("semantic_layer_artifacts.id", ondelete="SET NULL"),
        nullable=True,
    )
    schedule_cron = Column(String(120), nullable=True)
    next_run_at = Column(DateTime(timezone=True), nullable=True, index=True)
    enabled = Column(Boolean, nullable=False, server_default=text("true"))
    created_by = Column(UUID(as_uuid=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("organization_id", "slug", name="uq_data_pipeline_org_slug"),
        Index("ix_data_pipelines_due", "enabled", "next_run_at"),
    )


class DataLineageNode(BaseModel):
    """A node in the lineage graph: any asset data flows through."""

    __tablename__ = "data_lineage_nodes"

    organization_id = Column(
        UUID(as_uuid=True), *_organization_fk(), nullable=True, index=True
    )
    node_type = Column(
        Enum(
            "source_table",
            "bronze",
            "silver",
            "gold",
            "semantic_model",
            "chart",
            "dashboard",
            name="data_lineage_node_type_enum",
        ),
        nullable=False,
        index=True,
    )
    asset_id = Column(String, nullable=False, index=True)
    name = Column(String(500), nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "node_type",
            "asset_id",
            name="uq_data_lineage_node_identity",
        ),
    )


class DataLineageEdge(BaseModel):
    """A derivation between two lineage nodes, with column-level detail."""

    __tablename__ = "data_lineage_edges"

    from_node_id = Column(
        UUID(as_uuid=True),
        ForeignKey("data_lineage_nodes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    to_node_id = Column(
        UUID(as_uuid=True),
        ForeignKey("data_lineage_nodes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    edge_type = Column(
        Enum("derived_from", "reads", "writes", name="data_lineage_edge_type_enum"),
        nullable=False,
        server_default=text("'derived_from'"),
    )
    run_id = Column(
        UUID(as_uuid=True),
        ForeignKey("data_ingestion_jobs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    transform_step = Column(String(200), nullable=True)
    # {"out_col": ["in_col_a", "in_col_b"]}
    column_map = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))

    __table_args__ = (
        Index(
            "uq_data_lineage_edge_identity_with_step",
            "from_node_id",
            "to_node_id",
            "transform_step",
            unique=True,
            postgresql_where=text("transform_step IS NOT NULL"),
        ),
        Index(
            "uq_data_lineage_edge_identity_no_step",
            "from_node_id",
            "to_node_id",
            unique=True,
            postgresql_where=text("transform_step IS NULL"),
        ),
    )


class DataAssetProfile(BaseModel):
    """One profiling run over a lakehouse object.

    Append-only: a new run inserts a new row, so health is a time series and a
    later sub-project can chart or diff it. Nothing updates a profile in place.
    """

    __tablename__ = "data_asset_profiles"

    organization_id = Column(
        UUID(as_uuid=True), *_organization_fk(), nullable=True, index=True
    )
    lake_object_id = Column(
        UUID(as_uuid=True),
        ForeignKey("data_lake_objects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    layer = Column(
        Enum(
            "staging",
            "bronze",
            "silver",
            "gold",
            name="data_lake_layer_enum",
            create_type=False,
        ),
        nullable=False,
    )
    row_count = Column(Integer, nullable=False, server_default=text("0"))
    sampled = Column(Boolean, nullable=False, server_default=text("false"))
    health_score = Column(Integer, nullable=False, server_default=text("0"))
    profile = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    findings = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    duration_ms = Column(Integer, nullable=True)

    __table_args__ = (
        Index("ix_data_asset_profiles_object_created", "lake_object_id", "created_at"),
    )


class DataOnboardingSession(BaseModel):
    """A staged upload being walked from raw file to reviewed Bronze."""

    __tablename__ = "data_onboarding_sessions"

    organization_id = Column(
        UUID(as_uuid=True), *_organization_fk(), nullable=True, index=True
    )
    data_source_id = Column(
        String,
        ForeignKey("data_sources.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    staging_object_id = Column(
        UUID(as_uuid=True),
        ForeignKey("data_lake_objects.id", ondelete="SET NULL"),
        nullable=True,
    )
    bronze_object_id = Column(
        UUID(as_uuid=True),
        ForeignKey("data_lake_objects.id", ondelete="SET NULL"),
        nullable=True,
    )
    profile_id = Column(
        UUID(as_uuid=True),
        ForeignKey("data_asset_profiles.id", ondelete="SET NULL"),
        nullable=True,
    )
    status = Column(
        Enum(
            "profiling",
            "review",
            "ingesting",
            "ingested",
            "failed",
            "abandoned",
            name="data_onboarding_status_enum",
        ),
        nullable=False,
        server_default=text("'profiling'"),
        index=True,
    )
    decisions = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    error_message = Column(Text, nullable=True)
    created_by = Column(UUID(as_uuid=True), nullable=True)

    __table_args__ = (
        # Scoped by sheet, not just data_source_id: a multi-sheet workbook fans
        # out into one session per sheet (see select_sheets), all sharing the
        # same data_source_id and open at once. COALESCE to '' rather than
        # leaving sheet_name out of the index entirely -- Postgres treats NULL
        # as distinct from NULL in a unique index, which would silently stop
        # enforcing "one open session" for every plain (non-Excel) upload,
        # since none of those ever set sheet_name.
        Index(
            "uq_data_onboarding_open_per_source",
            "data_source_id",
            text("(COALESCE(decisions->>'sheet_name', ''))"),
            unique=True,
            postgresql_where=text("status IN ('profiling', 'review', 'ingesting')"),
        ),
    )


class DataModelRelationship(Base):
    """
    Join relationships between tables for a data source (semantic / dashboard joins).
    Table: data_model_relationships
    """

    __tablename__ = "data_model_relationships"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
        index=True,
    )
    data_source_id = Column(
        String,
        ForeignKey("data_sources.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    to_data_source_id = Column(
        String,
        ForeignKey("data_sources.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    from_table = Column(String, nullable=False)
    from_column = Column(String, nullable=False)
    to_table = Column(String, nullable=False)
    to_column = Column(String, nullable=False)
    join_type = Column(String, nullable=False, server_default=text("'LEFT'"))
    cardinality = Column(
        String(50), nullable=False, server_default=text("'one_to_many'")
    )
    cross_filter_direction = Column(
        String(20), nullable=False, server_default=text("'single'")
    )
    is_active = Column(Boolean, nullable=False, server_default=text("true"))
    assume_integrity = Column(Boolean, nullable=False, server_default=text("false"))
    created_at = Column(
        DateTime(timezone=True), nullable=True, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=True,
        server_default=func.now(),
        onupdate=func.now(),
    )


class ProjectDataSource(Base):
    """
    Many-to-many link between projects and data sources.
    Table: project_data_source (matches setup_database / seed_database).
    RBAC and data_connectivity_service use this for project-scoped data source access.
    """

    __tablename__ = "project_data_source"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
        index=True,
    )
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
    created_at = Column(
        DateTime(timezone=True), nullable=True, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=True,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Soft delete (nullable in DB)
    is_active = Column(Boolean, nullable=True, server_default=text("true"))


class ConnectorRuntimeJob(Base):
    """
    Stub job table for Agent Data Fabric connector runtime (batch/CDC/direct).
    Table: connector_runtime_jobs
    """

    __tablename__ = "connector_runtime_jobs"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
        index=True,
    )
    project_id = Column(UUID(as_uuid=True), *_project_fk(), nullable=True, index=True)
    connector_mode = Column(String(32), nullable=False, index=True)
    status = Column(String(32), nullable=False, server_default=text("'pending'"))
    config = Column(JSONB, nullable=True)
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


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
