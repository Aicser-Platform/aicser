"""Short share links for charts and dashboards.

Revision ID: 2026_11_02_share_links
Revises: 2026_11_02_seat_requests
"""

from alembic import op

revision = "2026_11_02_share_links"
down_revision = "2026_11_02_seat_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS share_links (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            slug VARCHAR(16) NOT NULL UNIQUE,
            kind VARCHAR(16) NOT NULL,
            resource_id UUID NOT NULL,
            organization_id UUID,
            created_by UUID NOT NULL,
            title VARCHAR(300),
            access VARCHAR(16) NOT NULL DEFAULT 'organization',
            status VARCHAR(16) NOT NULL DEFAULT 'active',
            live_data BOOLEAN NOT NULL DEFAULT false,
            expires_at TIMESTAMPTZ,
            password_hash VARCHAR(200),
            allowed_domains JSONB NOT NULL DEFAULT '[]'::jsonb,
            view_count INTEGER NOT NULL DEFAULT 0,
            last_viewed_at TIMESTAMPTZ,
            snapshot JSONB,
            snapshot_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            deleted_at TIMESTAMPTZ,
            is_active BOOLEAN NOT NULL DEFAULT true,
            is_deleted BOOLEAN NOT NULL DEFAULT false,
            CONSTRAINT uq_share_link_resource UNIQUE (kind, resource_id)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_share_links_org ON share_links (organization_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS share_links")
