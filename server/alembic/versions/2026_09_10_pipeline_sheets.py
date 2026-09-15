"""add data_pipeline_sheets: one table per sheet within a multi-table pipeline

Revision ID: 2026_09_10_pipeline_sheets
Revises: 2026_09_10_lake_source_table
Create Date: 2026-09-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "2026_09_10_pipeline_sheets"
down_revision: Union[str, None] = "2026_09_10_lake_source_table"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "data_pipeline_sheets",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "is_active", sa.Boolean(), server_default=sa.text("true"), nullable=True
        ),
        sa.Column(
            "is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=True
        ),
        sa.Column("pipeline_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_table", sa.String(), nullable=False),
        sa.Column("watermark_column", sa.String(), nullable=True),
        sa.Column("yaml_artifact_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["pipeline_id"], ["data_pipelines.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["yaml_artifact_id"], ["semantic_layer_artifacts.id"], ondelete="SET NULL"
        ),
        sa.UniqueConstraint(
            "pipeline_id", "source_table", name="uq_data_pipeline_sheet_table"
        ),
    )
    op.create_index(
        "ix_data_pipeline_sheets_pipeline_id",
        "data_pipeline_sheets",
        ["pipeline_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_data_pipeline_sheets_pipeline_id", table_name="data_pipeline_sheets"
    )
    op.drop_table("data_pipeline_sheets")
