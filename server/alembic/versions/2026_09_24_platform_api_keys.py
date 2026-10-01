"""Verifiable platform API keys (platform_api_keys).

Keys were previously stored only in masked form inside user_settings, so no presented key
could be verified. This table stores a SHA-256 of each key's secret plus owner, org and
revocation state (see src/modules/user/api_keys.py).
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "2026_09_24_platform_api_keys"
down_revision = "2026_09_24_decision_log"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "platform_api_keys",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("display_hint", sa.String(32), nullable=False),
        sa.Column("secret_hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_platform_api_keys_user", "platform_api_keys", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_platform_api_keys_user", table_name="platform_api_keys")
    op.drop_table("platform_api_keys")
