"""Why an alert's last check couldn't run

Revision ID: 2026_11_02_alert_last_error
Revises: 2026_11_02_push_subscriptions
Create Date: 2026-11-02
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "2026_11_02_alert_last_error"
down_revision: Union[str, None] = "2026_11_02_push_subscriptions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("alert_rules", sa.Column("last_error", sa.String(32), nullable=True))


def downgrade() -> None:
    op.drop_column("alert_rules", "last_error")
