"""Extend data_model_relationships with cardinality, cross_filter_direction, is_active, assume_integrity."""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "2026_06_26_dmr_extend"
down_revision = "j9f0a1b2c3d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "data_model_relationships",
        sa.Column("cardinality", sa.String(50), nullable=False, server_default="one_to_many"),
    )
    op.add_column(
        "data_model_relationships",
        sa.Column("cross_filter_direction", sa.String(20), nullable=False, server_default="single"),
    )
    op.add_column(
        "data_model_relationships",
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
    )
    op.add_column(
        "data_model_relationships",
        sa.Column("assume_integrity", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "data_model_relationships",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=True,
            server_default=sa.text("now()"),
        ),
    )


def downgrade() -> None:
    for col in ["updated_at", "assume_integrity", "is_active", "cross_filter_direction", "cardinality"]:
        op.drop_column("data_model_relationships", col)
