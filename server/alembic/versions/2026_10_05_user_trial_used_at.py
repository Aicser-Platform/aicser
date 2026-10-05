"""remember on the user that they used their free trial

users.trial_used_at is stamped by grant_trial_once and never cleared, so the trial is once per
user even after the organization it ran in is deleted or changes owner (the old per-user check
only looked at organizations the user currently owns). Backfilled from the owners of
organizations that already used their trial.

Revision ID: 2026_10_05_user_trial_used_at
Revises: 2026_10_03_bronze_one_snapshot
Create Date: 2026-10-05
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "2026_10_05_user_trial_used_at"
down_revision: Union[str, None] = "2026_10_03_bronze_one_snapshot"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("trial_used_at", sa.DateTime(timezone=True), nullable=True))
    # EE tables: absent on Community installs
    op.execute(
        """
        DO $$
        BEGIN
            IF to_regclass('organization_subscriptions') IS NOT NULL
               AND to_regclass('user_roles') IS NOT NULL
               AND to_regclass('roles') IS NOT NULL THEN
                UPDATE users u
                SET trial_used_at = t.first_trial
                FROM (
                    SELECT ur.user_id, MIN(s.trial_used_at) AS first_trial
                    FROM organization_subscriptions s
                    JOIN user_roles ur ON ur.organization_id = s.organization_id
                    JOIN roles r ON r.id = ur.role_id
                    WHERE r.name = 'org_owner' AND s.trial_used_at IS NOT NULL
                    GROUP BY ur.user_id
                ) t
                WHERE (u.id = t.user_id OR u.user_id = t.user_id)
                  AND u.trial_used_at IS NULL;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.drop_column("users", "trial_used_at")
