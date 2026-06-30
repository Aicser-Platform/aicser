"""Add to_data_source_id to data_model_relationships for cross-source joins."""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "2026_06_29_cross_source_rel"
down_revision = "2026_06_26_dmr_extend"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "data_model_relationships",
        sa.Column(
            "to_data_source_id",
            sa.String(),
            sa.ForeignKey("data_sources.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("data_model_relationships", "to_data_source_id")
