"""Add license_state table for self-hosted EE license-key validation.

One row per running instance. See src/core/licensing/models.py.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "2026_07_28_license_state"
down_revision = "2026_07_26_library_gaps"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "license_state",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("instance_id", sa.String(length=64), nullable=False),
        sa.Column("license_id", sa.String(length=64), nullable=True),
        sa.Column("entitlement_token", sa.Text(), nullable=True),
        sa.Column("is_valid", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("customer_id", sa.String(length=64), nullable=True),
        sa.Column("features", postgresql.JSONB(), server_default=sa.text("'[]'"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_validated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("current_timestamp"),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("current_timestamp"),
            nullable=True,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_license_state_instance_id", "license_state", ["instance_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_license_state_instance_id", table_name="license_state")
    op.drop_table("license_state")
