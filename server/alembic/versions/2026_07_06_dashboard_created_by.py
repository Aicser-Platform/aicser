"""Add created_by to dashboards for CE per-user scoping.

CE's GET /api/dashboards (DashboardService.list_all) returned every
dashboard in the database regardless of who created it -- there was no
column to scope by. This adds a nullable created_by so new dashboards can
be scoped to their creator; existing rows are left NULL (unknown owner)
rather than guessed, so pre-existing dashboards stay visible instead of
locking anyone out.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "2026_07_06_dash_created_by"
down_revision = "2026_06_29_cross_source_rel"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "dashboards",
        sa.Column(
            "created_by",
            sa.UUID(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("dashboards", "created_by")
