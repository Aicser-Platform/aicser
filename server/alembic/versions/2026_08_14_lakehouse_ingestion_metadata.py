"""add lakehouse ingestion metadata

Revision ID: 2026_08_14_lakehouse_meta
Revises: 2026_08_14_org_ds_access
Create Date: 2026-08-14
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "2026_08_14_lakehouse_meta"
down_revision: Union[str, None] = "2026_08_14_org_ds_access"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "data_lake_objects",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("data_source_id", sa.String(), nullable=True),
        sa.Column("layer", sa.Enum("bronze", "silver", "gold", name="data_lake_layer_enum"), nullable=False),
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column("storage_uri", sa.Text(), nullable=True),
        sa.Column("format", sa.String(length=50), server_default=sa.text("'parquet'"), nullable=False),
        sa.Column("version", sa.String(length=100), nullable=False),
        sa.Column("schema_snapshot", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("partition_values", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("checksum", sa.String(length=128), nullable=True),
        sa.Column("row_count", sa.Integer(), nullable=True),
        sa.Column("byte_size", sa.Integer(), nullable=True),
        sa.Column("status", sa.Enum("active", "superseded", "quarantined", "deleted", name="data_lake_object_status_enum"), server_default=sa.text("'active'"), nullable=False),
        sa.Column("created_by_job_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["data_source_id"], ["data_sources.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("object_key", "version", name="uq_data_lake_object_version"),
    )
    op.create_index("ix_data_lake_objects_data_source_id", "data_lake_objects", ["data_source_id"])
    op.create_index("ix_data_lake_objects_layer", "data_lake_objects", ["layer"])
    op.create_index("ix_data_lake_objects_organization_id", "data_lake_objects", ["organization_id"])
    op.create_index("ix_data_lake_objects_status", "data_lake_objects", ["status"])
    op.create_index("ix_data_lake_objects_source_layer", "data_lake_objects", ["data_source_id", "layer"])
    op.create_index("ix_data_lake_objects_created_by_job_id", "data_lake_objects", ["created_by_job_id"])

    op.create_table(
        "data_ingestion_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("data_source_id", sa.String(), nullable=True),
        sa.Column("source_kind", sa.Enum("file", "database", "api", "cdc", name="data_ingestion_source_kind_enum"), nullable=False),
        sa.Column("mode", sa.Enum("snapshot", "incremental", "cdc", name="data_ingestion_mode_enum"), nullable=False),
        sa.Column("target_layer", sa.Enum("bronze", "silver", "gold", name="data_ingestion_target_layer_enum"), server_default=sa.text("'bronze'"), nullable=False),
        sa.Column("status", sa.Enum("queued", "running", "succeeded", "failed", "cancelled", name="data_ingestion_status_enum"), server_default=sa.text("'queued'"), nullable=False),
        sa.Column("schedule_cron", sa.String(length=120), nullable=True),
        sa.Column("source_snapshot", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("options", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("checkpoint", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("output_object_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("rows_read", sa.Integer(), nullable=True),
        sa.Column("rows_written", sa.Integer(), nullable=True),
        sa.Column("bytes_written", sa.Integer(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_code", sa.String(length=100), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["data_source_id"], ["data_sources.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_data_ingestion_jobs_organization_id", "data_ingestion_jobs", ["organization_id"])
    op.create_index("ix_data_ingestion_jobs_project_id", "data_ingestion_jobs", ["project_id"])
    op.create_index("ix_data_ingestion_jobs_data_source_id", "data_ingestion_jobs", ["data_source_id"])
    op.create_index("ix_data_ingestion_jobs_status", "data_ingestion_jobs", ["status"])
    op.create_index("ix_data_ingestion_jobs_output_object_id", "data_ingestion_jobs", ["output_object_id"])
    op.create_index("ix_data_ingestion_jobs_source_status", "data_ingestion_jobs", ["data_source_id", "status"])

    op.create_table(
        "data_cdc_states",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("data_source_id", sa.String(), nullable=False),
        sa.Column("connector", sa.String(length=100), nullable=False),
        sa.Column("stream_name", sa.String(length=255), nullable=False),
        sa.Column("checkpoint", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("high_watermark", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("lag_seconds", sa.Integer(), nullable=True),
        sa.Column("last_event_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["data_source_id"], ["data_sources.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("data_source_id", "connector", "stream_name", name="uq_data_cdc_state_stream"),
    )
    op.create_index("ix_data_cdc_states_organization_id", "data_cdc_states", ["organization_id"])
    op.create_index("ix_data_cdc_states_data_source_id", "data_cdc_states", ["data_source_id"])

    op.create_table(
        "semantic_layer_artifacts",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("data_source_id", sa.String(), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("version", sa.String(length=100), nullable=False),
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column("storage_uri", sa.Text(), nullable=True),
        sa.Column("format", sa.String(length=50), server_default=sa.text("'yaml'"), nullable=False),
        sa.Column("model_snapshot", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("status", sa.Enum("draft", "published", "archived", name="semantic_layer_artifact_status_enum"), server_default=sa.text("'draft'"), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["data_source_id"], ["data_sources.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("data_source_id", "name", "version", name="uq_semantic_layer_artifact_version"),
    )
    op.create_index("ix_semantic_layer_artifacts_organization_id", "semantic_layer_artifacts", ["organization_id"])
    op.create_index("ix_semantic_layer_artifacts_project_id", "semantic_layer_artifacts", ["project_id"])
    op.create_index("ix_semantic_layer_artifacts_data_source_id", "semantic_layer_artifacts", ["data_source_id"])
    op.create_index("ix_semantic_layer_artifacts_source_status", "semantic_layer_artifacts", ["data_source_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_semantic_layer_artifacts_source_status", table_name="semantic_layer_artifacts")
    op.drop_index("ix_semantic_layer_artifacts_data_source_id", table_name="semantic_layer_artifacts")
    op.drop_index("ix_semantic_layer_artifacts_project_id", table_name="semantic_layer_artifacts")
    op.drop_index("ix_semantic_layer_artifacts_organization_id", table_name="semantic_layer_artifacts")
    op.drop_table("semantic_layer_artifacts")

    op.drop_index("ix_data_cdc_states_data_source_id", table_name="data_cdc_states")
    op.drop_index("ix_data_cdc_states_organization_id", table_name="data_cdc_states")
    op.drop_table("data_cdc_states")

    op.drop_index("ix_data_ingestion_jobs_source_status", table_name="data_ingestion_jobs")
    op.drop_index("ix_data_ingestion_jobs_output_object_id", table_name="data_ingestion_jobs")
    op.drop_index("ix_data_ingestion_jobs_status", table_name="data_ingestion_jobs")
    op.drop_index("ix_data_ingestion_jobs_data_source_id", table_name="data_ingestion_jobs")
    op.drop_index("ix_data_ingestion_jobs_project_id", table_name="data_ingestion_jobs")
    op.drop_index("ix_data_ingestion_jobs_organization_id", table_name="data_ingestion_jobs")
    op.drop_table("data_ingestion_jobs")

    op.drop_index("ix_data_lake_objects_created_by_job_id", table_name="data_lake_objects")
    op.drop_index("ix_data_lake_objects_source_layer", table_name="data_lake_objects")
    op.drop_index("ix_data_lake_objects_status", table_name="data_lake_objects")
    op.drop_index("ix_data_lake_objects_organization_id", table_name="data_lake_objects")
    op.drop_index("ix_data_lake_objects_layer", table_name="data_lake_objects")
    op.drop_index("ix_data_lake_objects_data_source_id", table_name="data_lake_objects")
    op.drop_table("data_lake_objects")

    for enum_name in (
        "semantic_layer_artifact_status_enum",
        "data_ingestion_status_enum",
        "data_ingestion_target_layer_enum",
        "data_ingestion_mode_enum",
        "data_ingestion_source_kind_enum",
        "data_lake_object_status_enum",
        "data_lake_layer_enum",
    ):
        op.execute(sa.text(f"DROP TYPE IF EXISTS {enum_name}"))
