"""A Light member's request for an AI seat.

Revision ID: 2026_11_02_seat_requests
Revises: 2026_11_02_alert_channel_secrets
"""

import sqlalchemy as sa
from alembic import op

revision = "2026_11_02_seat_requests"
down_revision = "2026_11_02_alert_channel_secrets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE IF EXISTS organization_seats ADD COLUMN IF NOT EXISTS ai_requested_at TIMESTAMPTZ")


def downgrade() -> None:
    op.execute("ALTER TABLE IF EXISTS organization_seats DROP COLUMN IF EXISTS ai_requested_at")
