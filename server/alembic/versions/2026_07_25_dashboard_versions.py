"""Add dashboard_versions table for server-backed Studio version history.

Version history (named snapshots of a dashboard's widgets/layout) used to
live entirely client-side in localStorage (aicser_dash_versions_<id>),
capped at 20 per dashboard. That made history invisible to teammates and
lost whenever browser storage was cleared -- a real gap given this same
dashboard already supports real-time multi-user collaborative editing. This
adds a server-backed table so history is shared and durable; the 20-version
cap is now enforced by DashboardVersionsService instead of client JS.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "2026_07_25_dashboard_versions"
down_revision = "2026_07_08_avatar_url_text"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dashboard_versions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("dashboard_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=True),
        sa.Column("config", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(["dashboard_id"], ["dashboards.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_dashboard_versions_id", "dashboard_versions", ["id"])
    op.create_index("ix_dashboard_versions_dashboard_id", "dashboard_versions", ["dashboard_id"])
    op.create_index("ix_dashboard_versions_created_by", "dashboard_versions", ["created_by"])


def downgrade() -> None:
    op.drop_index("ix_dashboard_versions_created_by", table_name="dashboard_versions")
    op.drop_index("ix_dashboard_versions_dashboard_id", table_name="dashboard_versions")
    op.drop_index("ix_dashboard_versions_id", table_name="dashboard_versions")
    op.drop_table("dashboard_versions")
