"""Add optional project target to organization invitations.

Revision ID: 2026_07_16_project_invites
Revises: e1f2a3b4c5d6
Create Date: 2026-07-16
"""

import os
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "2026_07_16_project_invites"
down_revision: Union[str, None] = "e1f2a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _is_ee_enabled() -> bool:
    edition = os.getenv("AISER_EDITION", "community").strip().lower()
    return edition in {"enterprise", "ee"} or bool(os.getenv("AISER_EDITION_LICENSE_KEY", "").strip())


def upgrade() -> None:
    if not _is_ee_enabled():
        return

    op.add_column(
        "organization_invitations",
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "organization_invitations",
        sa.Column("project_role_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index(
        op.f("ix_organization_invitations_project_id"),
        "organization_invitations",
        ["project_id"],
        unique=False,
    )
    op.create_foreign_key(
        "fk_org_invites_project_id",
        "organization_invitations",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_org_invites_project_role_id",
        "organization_invitations",
        "roles",
        ["project_role_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    if not _is_ee_enabled():
        return

    op.drop_constraint("fk_org_invites_project_role_id", "organization_invitations", type_="foreignkey")
    op.drop_constraint("fk_org_invites_project_id", "organization_invitations", type_="foreignkey")
    op.drop_index(op.f("ix_organization_invitations_project_id"), table_name="organization_invitations")
    op.drop_column("organization_invitations", "project_role_id")
    op.drop_column("organization_invitations", "project_id")
