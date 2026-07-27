"""Add custom icon_emoji/color columns to organizations and projects."""
import os
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


def _is_ee_enabled() -> bool:
    edition = os.getenv("AISER_EDITION", "community").strip().lower()
    return edition in {"enterprise", "ee"} or bool(os.getenv("AISER_EDITION_LICENSE_KEY", "").strip())


revision: str = "2026_07_24_org_project_icon"
down_revision: Union[str, Sequence[str], None] = "2026_07_16_project_invites"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set[str]:
    bind = op.get_bind()
    return {col["name"] for col in inspect(bind).get_columns(table)}


def upgrade() -> None:
    if not _is_ee_enabled():
        return

    org_cols = _columns("organizations")
    if "icon_emoji" not in org_cols:
        op.add_column("organizations", sa.Column("icon_emoji", sa.String(length=32), nullable=True))
    if "color" not in org_cols:
        op.add_column("organizations", sa.Column("color", sa.String(length=16), nullable=True))

    project_cols = _columns("projects")
    if "icon_emoji" not in project_cols:
        op.add_column("projects", sa.Column("icon_emoji", sa.String(length=32), nullable=True))
    if "color" not in project_cols:
        op.add_column("projects", sa.Column("color", sa.String(length=16), nullable=True))


def downgrade() -> None:
    if not _is_ee_enabled():
        return

    op.drop_column("projects", "color")
    op.drop_column("projects", "icon_emoji")
    op.drop_column("organizations", "color")
    op.drop_column("organizations", "icon_emoji")
