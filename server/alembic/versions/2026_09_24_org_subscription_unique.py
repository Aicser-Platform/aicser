"""One subscription row per organization, and backfill trial_used_at for trials already running.

Billing code reads a single row per org (scalar_one_or_none) and the trial grant updates that
row in place; without a unique index nothing stopped a second row. Trials granted before
trial_used_at existed (onboarding) are marked used so they can't be claimed again.
"""
from alembic import op

revision = "2026_09_24_org_sub_unique"
down_revision = "2026_09_24_scim_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE organization_subscriptions
        SET trial_used_at = COALESCE(trial_ends_at - INTERVAL '14 days', created_at, NOW())
        WHERE trial_used_at IS NULL AND (status = 'trialing' OR trial_ends_at IS NOT NULL)
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_organization_subscriptions_org "
        "ON organization_subscriptions (organization_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_organization_subscriptions_org")
