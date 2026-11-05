"""An AI agent's own icon. Without one it shows the organization's logo."""

from __future__ import annotations

from alembic import op

revision = "2026_11_04_agent_icons"
down_revision = "2026_11_04_ai_agents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE embed_assistants ADD COLUMN IF NOT EXISTS icon_url TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE embed_assistants DROP COLUMN IF EXISTS icon_url")
