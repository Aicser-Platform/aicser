"""Replication-log CDC inbox (Debezium-compatible) + log_cdc ingest mode.

Revision ID: 2026_10_12_log_cdc
Revises: 2026_10_11_ontology_graph
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "2026_10_12_log_cdc"
down_revision: Union[str, None] = "2026_10_11_ontology_graph"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TYPE data_pipeline_ingest_mode_enum ADD VALUE IF NOT EXISTS 'log_cdc'"
    )
    op.execute(
        "ALTER TYPE data_ingestion_mode_enum ADD VALUE IF NOT EXISTS 'log_cdc'"
    )

    op.create_table(
        "data_pipeline_cdc_events",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "data_source_id",
            sa.String(),
            sa.ForeignKey("data_sources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("stream_name", sa.String(255), nullable=False),
        sa.Column("op", sa.String(1), nullable=False),
        sa.Column("row_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("before_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("source_offset", sa.String(512), nullable=True),
        sa.Column("source_ts_ms", sa.BigInteger(), nullable=True),
        sa.Column(
            "status",
            sa.Enum("pending", "committed", name="data_pipeline_cdc_event_status_enum"),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
        sa.Column("committed_load_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_data_pipeline_cdc_events_pending",
        "data_pipeline_cdc_events",
        ["data_source_id", "stream_name", "status", "created_at"],
    )
    op.create_index(
        "ix_data_pipeline_cdc_events_org",
        "data_pipeline_cdc_events",
        ["organization_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_data_pipeline_cdc_events_org", table_name="data_pipeline_cdc_events")
    op.drop_index(
        "ix_data_pipeline_cdc_events_pending", table_name="data_pipeline_cdc_events"
    )
    op.drop_table("data_pipeline_cdc_events")
    op.execute("DROP TYPE IF EXISTS data_pipeline_cdc_event_status_enum")
    # PostgreSQL cannot remove enum values safely; leave log_cdc on ingest enums.
