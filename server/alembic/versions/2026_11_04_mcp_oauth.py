"""Sign-in for outside AI clients (Copilot, Gemini and others) on the MCP server."""

from __future__ import annotations

from alembic import op

revision = "2026_11_04_mcp_oauth"
down_revision = "2026_11_04_share_link_reminders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
            client_id VARCHAR(64) PRIMARY KEY,
            client_name VARCHAR(200) NOT NULL,
            secret_hash VARCHAR(64),
            redirect_uris JSONB NOT NULL DEFAULT '[]'::jsonb,
            organization_id UUID,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS mcp_oauth_grants (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            client_id VARCHAR(64) NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
            user_id UUID NOT NULL,
            organization_id UUID NOT NULL,
            refresh_hash VARCHAR(64) NOT NULL,
            previous_refresh_hash VARCHAR(64),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_used_at TIMESTAMPTZ,
            expires_at TIMESTAMPTZ NOT NULL,
            revoked_at TIMESTAMPTZ
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_mcp_oauth_grants_user ON mcp_oauth_grants (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_mcp_oauth_grants_org ON mcp_oauth_grants (organization_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_mcp_oauth_grants_refresh ON mcp_oauth_grants (refresh_hash)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_mcp_oauth_grants_previous ON mcp_oauth_grants (previous_refresh_hash)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS mcp_oauth_grants")
    op.execute("DROP TABLE IF EXISTS mcp_oauth_clients")
