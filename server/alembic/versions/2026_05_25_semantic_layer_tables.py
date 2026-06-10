"""Add semantic_metrics and semantic_dimensions tables."""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d4e5f6a7b8c0"
down_revision: Union[str, None] = "c3d4e5f6a7b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "semantic_metrics",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("data_source_id", sa.String(), sa.ForeignKey("data_sources.id", ondelete="CASCADE"), nullable=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("expression", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category", sa.String(), server_default="general", nullable=False),
        sa.Column("owner", sa.String(), nullable=True),
        sa.Column("tags", sa.Text(), server_default="[]", nullable=True),
        sa.Column("format", sa.String(), nullable=True),
        sa.Column("source", sa.String(), server_default="manual", nullable=False),
        sa.Column("source_ref", sa.String(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_semantic_metrics_data_source_id", "semantic_metrics", ["data_source_id"])
    op.create_index("ix_semantic_metrics_project_id", "semantic_metrics", ["project_id"])

    op.create_table(
        "semantic_dimensions",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("data_source_id", sa.String(), sa.ForeignKey("data_sources.id", ondelete="CASCADE"), nullable=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("expression", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("hierarchy", sa.Text(), server_default="[]", nullable=True),
        sa.Column("values_sample", sa.Text(), server_default="[]", nullable=True),
        sa.Column("source", sa.String(), server_default="manual", nullable=False),
        sa.Column("source_ref", sa.String(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_semantic_dimensions_data_source_id", "semantic_dimensions", ["data_source_id"])
    op.create_index("ix_semantic_dimensions_project_id", "semantic_dimensions", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_semantic_dimensions_project_id", table_name="semantic_dimensions")
    op.drop_index("ix_semantic_dimensions_data_source_id", table_name="semantic_dimensions")
    op.drop_table("semantic_dimensions")
    op.drop_index("ix_semantic_metrics_project_id", table_name="semantic_metrics")
    op.drop_index("ix_semantic_metrics_data_source_id", table_name="semantic_metrics")
    op.drop_table("semantic_metrics")
