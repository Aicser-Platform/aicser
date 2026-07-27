"""Chart library: collections, favorites, usage-friendly indexes, unique dashboard links.

Adds server-backed collections for Chart Designer, lightweight org metadata on charts,
and a unique (dashboard_id, chart_id) constraint so pin/link cannot duplicate placements.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "2026_07_26_chart_library"
down_revision = "2026_07_25_dashboard_versions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chart_collections",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(["parent_id"], ["chart_collections.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chart_collections_user_id", "chart_collections", ["user_id"])
    op.create_index("ix_chart_collections_project_id", "chart_collections", ["project_id"])
    op.create_index("ix_chart_collections_parent_id", "chart_collections", ["parent_id"])

    op.add_column(
        "charts",
        sa.Column("collection_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "charts",
        sa.Column("is_favorite", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column(
        "charts",
        sa.Column("last_opened_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "charts",
        sa.Column(
            "tags",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )
    op.create_foreign_key(
        "fk_charts_collection_id",
        "charts",
        "chart_collections",
        ["collection_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_charts_collection_id", "charts", ["collection_id"])
    op.create_index("ix_charts_is_favorite", "charts", ["is_favorite"])
    op.create_index("ix_charts_last_opened_at", "charts", ["last_opened_at"])

    # Deduplicate link rows before unique constraint
    op.execute(
        """
        DELETE FROM dashboard_charts a
        USING dashboard_charts b
        WHERE a.ctid < b.ctid
          AND a.dashboard_id = b.dashboard_id
          AND a.chart_id = b.chart_id
        """
    )
    op.create_unique_constraint(
        "uq_dashboard_charts_dashboard_chart",
        "dashboard_charts",
        ["dashboard_id", "chart_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_dashboard_charts_dashboard_chart", "dashboard_charts", type_="unique")
    op.drop_index("ix_charts_last_opened_at", table_name="charts")
    op.drop_index("ix_charts_is_favorite", table_name="charts")
    op.drop_index("ix_charts_collection_id", table_name="charts")
    op.drop_constraint("fk_charts_collection_id", "charts", type_="foreignkey")
    op.drop_column("charts", "tags")
    op.drop_column("charts", "last_opened_at")
    op.drop_column("charts", "is_favorite")
    op.drop_column("charts", "collection_id")
    op.drop_index("ix_chart_collections_parent_id", table_name="chart_collections")
    op.drop_index("ix_chart_collections_project_id", table_name="chart_collections")
    op.drop_index("ix_chart_collections_user_id", table_name="chart_collections")
    op.drop_table("chart_collections")
