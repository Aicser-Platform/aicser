"""Org-scope dashboard_templates and wire it up for real save/list/update/delete.

dashboard_templates has existed since the initial migration with full
CRUD-ready fields (is_public, is_featured, usage_count, rating,
required_plan) but was never actually used by any router/service - no
organization_id column exists on it, so there was no way to scope "my org's
saved templates" apart from the 5 hardcoded sample templates. Backfilling
organization_id is safe: the table has been dead code (no writer anywhere
in the codebase), so there is no real data to migrate.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "2026_08_25_dash_tpl_org_scope"
down_revision = "2026_08_25_report_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "dashboard_templates",
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_dashboard_templates_organization_id",
        "dashboard_templates",
        "organizations",
        ["organization_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_dashboard_templates_organization_id", "dashboard_templates", ["organization_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_dashboard_templates_organization_id", table_name="dashboard_templates")
    op.drop_constraint("fk_dashboard_templates_organization_id", "dashboard_templates", type_="foreignkey")
    op.drop_column("dashboard_templates", "organization_id")
