"""Add TOTP two-factor authentication columns and pending-login table."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "2026_08_27_totp_2fa"
down_revision = "e2b3c4d5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT")
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false"
    )
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_backup_codes JSONB")

    op.create_table(
        "two_factor_pending_logins",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
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
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_two_factor_pending_logins_user_id", "two_factor_pending_logins", ["user_id"], unique=False
    )
    op.create_index(
        "ix_two_factor_pending_logins_token_hash", "two_factor_pending_logins", ["token_hash"], unique=True
    )
    op.create_index(
        "ix_two_factor_pending_logins_expires_at", "two_factor_pending_logins", ["expires_at"], unique=False
    )
    op.create_index(
        "ix_two_factor_pending_logins_used_at", "two_factor_pending_logins", ["used_at"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_two_factor_pending_logins_used_at", table_name="two_factor_pending_logins")
    op.drop_index("ix_two_factor_pending_logins_expires_at", table_name="two_factor_pending_logins")
    op.drop_index("ix_two_factor_pending_logins_token_hash", table_name="two_factor_pending_logins")
    op.drop_index("ix_two_factor_pending_logins_user_id", table_name="two_factor_pending_logins")
    op.drop_table("two_factor_pending_logins")

    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS totp_backup_codes")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS totp_enabled")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS totp_secret")
