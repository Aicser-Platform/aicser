"""Add trial_used_at to organization_subscriptions for one-time trial enforcement.

Distinct from trial_ends_at (current trial's expiry) and trial_expiring_soon
(24h-before-expiry notification flag) -- this timestamp is set once, the
first time an org ever starts a self-serve trial (POST /pricing/start-trial),
and is NEVER cleared afterwards, including when revert_expired_trials()
reverts the org back to the free plan -- so a used trial can't be replayed.
"""
from alembic import op
import sqlalchemy as sa

revision = "2026_09_14_trial_used_at"
down_revision = "2026_09_09_feed_attach_insight"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "organization_subscriptions",
        sa.Column("trial_used_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("organization_subscriptions", "trial_used_at")
