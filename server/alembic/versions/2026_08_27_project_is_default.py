"""Add is_default flag to projects, and backfill existing auto-provisioned
default projects so they stop counting against plan project quotas.

Root cause: organization creation (and onboarding, and first-data-upload)
auto-provisions a default private project so a new org isn't empty. That
auto-created project was indistinguishable from a real one, so it silently
consumed a Free plan's only project slot -- a brand-new user's first
deliberate "Create Project" click 403'd with "plan allows 1 project"
despite having created zero projects themselves.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "2026_08_27_project_is_default"
down_revision = "2026_08_27_totp_2fa"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false"
    )

    # Backfill: an org's oldest active, non-deleted, private project --
    # created within a few seconds of the org itself -- is almost certainly
    # the auto-provisioned default rather than one a user deliberately
    # created afterward. This is a best-effort heuristic for EXISTING data;
    # every auto-provisioning call site is updated separately to set
    # is_default=True explicitly going forward, so this backfill only
    # matters for orgs created before this migration.
    op.execute(
        """
        WITH candidate AS (
            SELECT DISTINCT ON (p.organization_id)
                p.id
            FROM projects p
            JOIN organizations o ON o.id = p.organization_id
            WHERE p.is_deleted = false
              AND p.is_active = true
              AND p.is_private = true
              AND p.created_at <= o.created_at + INTERVAL '30 seconds'
            ORDER BY p.organization_id, p.created_at ASC
        )
        UPDATE projects
        SET is_default = true
        WHERE id IN (SELECT id FROM candidate)
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS is_default")
