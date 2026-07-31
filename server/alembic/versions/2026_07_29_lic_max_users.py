"""Add max_users to license_state.

This also merges the two CE heads that existed after the license_state branch,
so running Alembic has one CE target again.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "2026_07_29_lic_max_users"
down_revision: Union[str, Sequence[str], None] = (
    "2026_07_28_license_state",
    "2026_07_08_email_provider_unique",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE license_state ADD COLUMN IF NOT EXISTS max_users INTEGER")


def downgrade() -> None:
    op.execute("ALTER TABLE license_state DROP COLUMN IF EXISTS max_users")
