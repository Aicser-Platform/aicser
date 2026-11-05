"""Remember whether this instance's license is a trial, across restarts."""

from __future__ import annotations

from alembic import op

revision = "2026_11_04_license_type"
down_revision = "2026_11_04_sandbox_workspaces"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE license_state ADD COLUMN IF NOT EXISTS license_type VARCHAR(32)")


def downgrade() -> None:
    op.execute("ALTER TABLE license_state DROP COLUMN IF EXISTS license_type")
