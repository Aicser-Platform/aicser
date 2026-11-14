"""Seats a Team bought on top of the ones its plan includes."""

from alembic import op

revision = "2026_11_05_seat_extras"
down_revision = "2026_11_04_agent_icons"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE IF EXISTS organization_subscriptions ADD COLUMN IF NOT EXISTS extra_ai_seats INTEGER NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE IF EXISTS organization_subscriptions ADD COLUMN IF NOT EXISTS extra_light_seats INTEGER NOT NULL DEFAULT 0")


def downgrade() -> None:
    op.execute("ALTER TABLE IF EXISTS organization_subscriptions DROP COLUMN IF EXISTS extra_light_seats")
    op.execute("ALTER TABLE IF EXISTS organization_subscriptions DROP COLUMN IF EXISTS extra_ai_seats")
