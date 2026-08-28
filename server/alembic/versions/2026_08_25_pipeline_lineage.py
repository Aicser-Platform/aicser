"""add data_pipelines and lineage graph tables

Revision ID: 2026_08_25_pipeline_lineage
Revises: 2026_08_20_column_security
Create Date: 2026-08-25
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "2026_08_25_pipeline_lineage"
down_revision: Union[str, None] = "2026_08_20_column_security"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_BASE_COLS = lambda: [
    sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
    sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
    sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=True),
    sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=True),
]


def upgrade() -> None:
    # Schema that PyIceberg's SqlCatalog owns. Excluded from autogenerate in env.py.
    op.execute("CREATE SCHEMA IF NOT EXISTS iceberg_catalog")

    op.create_table(
        "data_pipelines",
        *_BASE_COLS(),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("slug", sa.String(length=200), nullable=False),
        sa.Column("source_asset_type", sa.Enum("data_source", "lake_object", name="data_pipeline_source_asset_type_enum"), nullable=False),
        sa.Column("source_asset_id", sa.String(), nullable=False),
        sa.Column("target_layer", sa.Enum("silver", "gold", name="data_pipeline_target_layer_enum"), server_default=sa.text("'silver'"), nullable=False),
        sa.Column("ingest_mode", sa.Enum("snapshot", "incremental", "cdc", name="data_pipeline_ingest_mode_enum"), server_default=sa.text("'snapshot'"), nullable=False),
        sa.Column("yaml_artifact_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("schedule_cron", sa.String(length=120), nullable=True),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["yaml_artifact_id"], ["semantic_layer_artifacts.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("organization_id", "slug", name="uq_data_pipeline_org_slug"),
    )
    op.create_index("ix_data_pipelines_due", "data_pipelines", ["enabled", "next_run_at"])
    op.create_index("ix_data_pipelines_organization_id", "data_pipelines", ["organization_id"])
    op.create_index("ix_data_pipelines_source_asset_id", "data_pipelines", ["source_asset_id"])

    op.add_column("data_ingestion_jobs", sa.Column("pipeline_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_data_ingestion_jobs_pipeline_id", "data_ingestion_jobs",
        "data_pipelines", ["pipeline_id"], ["id"], ondelete="CASCADE",
    )
    op.create_index("ix_data_ingestion_jobs_pipeline_id", "data_ingestion_jobs", ["pipeline_id"])

    op.create_table(
        "data_lineage_nodes",
        *_BASE_COLS(),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("node_type", sa.Enum("source_table", "bronze", "silver", "gold", "semantic_model", "chart", "dashboard", name="data_lineage_node_type_enum"), nullable=False),
        sa.Column("asset_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(length=500), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "node_type", "asset_id", name="uq_data_lineage_node_identity"),
    )
    op.create_index("ix_data_lineage_nodes_asset_id", "data_lineage_nodes", ["asset_id"])
    op.create_index("ix_data_lineage_nodes_node_type", "data_lineage_nodes", ["node_type"])

    op.create_table(
        "data_lineage_edges",
        *_BASE_COLS(),
        sa.Column("from_node_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("to_node_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("edge_type", sa.Enum("derived_from", "reads", "writes", name="data_lineage_edge_type_enum"), server_default=sa.text("'derived_from'"), nullable=False),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("transform_step", sa.String(length=200), nullable=True),
        sa.Column("column_map", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["from_node_id"], ["data_lineage_nodes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["to_node_id"], ["data_lineage_nodes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["run_id"], ["data_ingestion_jobs.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_data_lineage_edges_from_node_id", "data_lineage_edges", ["from_node_id"])
    op.create_index("ix_data_lineage_edges_to_node_id", "data_lineage_edges", ["to_node_id"])
    op.create_index("ix_data_lineage_edges_run_id", "data_lineage_edges", ["run_id"])
    op.create_index(
        "uq_data_lineage_edge_identity_with_step",
        "data_lineage_edges",
        ["from_node_id", "to_node_id", "transform_step"],
        unique=True,
        postgresql_where=sa.text("transform_step IS NOT NULL"),
    )
    op.create_index(
        "uq_data_lineage_edge_identity_no_step",
        "data_lineage_edges",
        ["from_node_id", "to_node_id"],
        unique=True,
        postgresql_where=sa.text("transform_step IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_data_lineage_edge_identity_no_step", table_name="data_lineage_edges")
    op.drop_index("uq_data_lineage_edge_identity_with_step", table_name="data_lineage_edges")
    op.drop_table("data_lineage_edges")
    op.drop_table("data_lineage_nodes")
    op.drop_index("ix_data_ingestion_jobs_pipeline_id", table_name="data_ingestion_jobs")
    op.drop_constraint("fk_data_ingestion_jobs_pipeline_id", "data_ingestion_jobs", type_="foreignkey")
    op.drop_column("data_ingestion_jobs", "pipeline_id")
    op.drop_table("data_pipelines")
    for enum_name in (
        "data_lineage_edge_type_enum", "data_lineage_node_type_enum",
        "data_pipeline_ingest_mode_enum", "data_pipeline_target_layer_enum",
        "data_pipeline_source_asset_type_enum",
    ):
        op.execute(f"DROP TYPE IF EXISTS {enum_name}")
