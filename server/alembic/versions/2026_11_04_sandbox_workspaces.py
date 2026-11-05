"""Sandbox workspaces: short-lived organizations for trying Aicser without signing up."""

from __future__ import annotations

from alembic import op

revision = "2026_11_04_sandbox_workspaces"
down_revision = "2026_11_02_share_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS sandbox_workspaces (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id),
            owner_user_id UUID NOT NULL,
            tier VARCHAR(16) NOT NULL DEFAULT 'guest',
            status VARCHAR(16) NOT NULL DEFAULT 'active',
            email_hash VARCHAR(64),
            domain_hash VARCHAR(64),
            ip_hash VARCHAR(64),
            email VARCHAR(255),
            company VARCHAR(255),
            phone VARCHAR(32),
            expires_at TIMESTAMPTZ NOT NULL,
            purge_at TIMESTAMPTZ NOT NULL,
            kept_at TIMESTAMPTZ,
            purged_at TIMESTAMPTZ,
            signals JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            deleted_at TIMESTAMPTZ,
            is_active BOOLEAN DEFAULT true,
            is_deleted BOOLEAN DEFAULT false
        )
    """)
    for column in ("owner_user_id", "status", "email_hash", "domain_hash", "ip_hash", "expires_at", "purge_at"):
        op.execute(f"CREATE INDEX IF NOT EXISTS ix_sandbox_workspaces_{column} ON sandbox_workspaces ({column})")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS sandbox_workspaces")
