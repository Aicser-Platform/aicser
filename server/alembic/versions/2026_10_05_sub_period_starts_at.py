"""record when a subscription's current paid term started

organization_subscriptions only had ends_at, so a period's start couldn't be shown or checked
against its end. period_starts_at is written by Stripe sync (current period start), KHQR
provisioning and trial grants; existing rows stay null until their next update.

Revision ID: 2026_10_05_sub_period_starts_at
Revises: 2026_10_05_user_trial_used_at
Create Date: 2026-10-05
"""

from typing import Sequence, Union

from alembic import op

revision: str = "2026_10_05_sub_period_starts_at"
down_revision: Union[str, None] = "2026_10_05_user_trial_used_at"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # EE table: absent on Community installs
    op.execute(
        "ALTER TABLE IF EXISTS organization_subscriptions "
        "ADD COLUMN IF NOT EXISTS period_starts_at TIMESTAMPTZ"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE IF EXISTS organization_subscriptions DROP COLUMN IF EXISTS period_starts_at")
