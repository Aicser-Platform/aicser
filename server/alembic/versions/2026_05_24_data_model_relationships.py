"""Add data_model_relationships table."""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c3d4e5f6a7b9"
down_revision: Union[str, None] = "b2c3d4e5f6a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "data_model_relationships",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("data_source_id", sa.String(), sa.ForeignKey("data_sources.id", ondelete="CASCADE"), nullable=False),
        sa.Column("from_table", sa.String(), nullable=False),
        sa.Column("from_column", sa.String(), nullable=False),
        sa.Column("to_table", sa.String(), nullable=False),
        sa.Column("to_column", sa.String(), nullable=False),
        sa.Column("join_type", sa.String(), server_default="LEFT", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_data_model_relationships_data_source_id", "data_model_relationships", ["data_source_id"])


def downgrade() -> None:
    op.drop_index("ix_data_model_relationships_data_source_id", table_name="data_model_relationships")
    op.drop_table("data_model_relationships")
