"""clear a previous subscription's ends_at from rows now on a trial

grant_trial_once updated the org's subscription row to a trial without clearing ends_at. When
the earlier subscription had ended, the feature gate (_subscription_inactive) saw that past
ends_at and resolved the trialing org to the free tier (402 on lakehouse and other paid
features) while billing still showed the trial. Only rows whose ends_at predates the trial
grant are touched; downgrade is a no-op (the old values were wrong).

Revision ID: 2026_10_02_trial_clear_ends_at
Revises: 2026_10_02_lake_registry
Create Date: 2026-10-02
"""

from typing import Sequence, Union

from alembic import op

revision: str = "2026_10_02_trial_clear_ends_at"
down_revision: Union[str, None] = "2026_10_02_lake_registry"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # EE table: absent on Community installs
    op.execute(
        """
        DO $$
        BEGIN
            IF to_regclass('organization_subscriptions') IS NOT NULL THEN
                UPDATE organization_subscriptions
                SET ends_at = NULL
                WHERE status = 'trialing'
                  AND ends_at IS NOT NULL
                  AND trial_used_at IS NOT NULL
                  AND ends_at < trial_used_at;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    pass
