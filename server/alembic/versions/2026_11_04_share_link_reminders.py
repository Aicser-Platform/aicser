"""One reminder for a share link waiting on approval."""

from __future__ import annotations

from alembic import op

revision = "2026_11_04_share_link_reminders"
down_revision = "2026_11_04_license_type"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE share_links ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ")


def downgrade() -> None:
    op.execute("ALTER TABLE share_links DROP COLUMN IF EXISTS reminded_at")
