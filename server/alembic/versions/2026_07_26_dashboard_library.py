"""Dashboard library: collections, favorites, recent, tags — mirror chart library.

Adds server-backed collections for Studio / pin pickers, lightweight org metadata
on dashboards, and indexes for paginated facet queries at scale.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "2026_07_26_dashboard_library"
down_revision = "2026_07_26_chart_library"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dashboard_collections",
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
        sa.ForeignKeyConstraint(
            ["parent_id"], ["dashboard_collections.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_dashboard_collections_user_id", "dashboard_collections", ["user_id"])
    op.create_index(
        "ix_dashboard_collections_project_id", "dashboard_collections", ["project_id"]
    )
    op.create_index(
        "ix_dashboard_collections_parent_id", "dashboard_collections", ["parent_id"]
    )

    op.add_column(
        "dashboards",
        sa.Column("collection_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "dashboards",
        sa.Column(
            "is_favorite",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.add_column(
        "dashboards",
        sa.Column("last_opened_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "dashboards",
        sa.Column(
            "tags",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )
    op.create_foreign_key(
        "fk_dashboards_collection_id",
        "dashboards",
        "dashboard_collections",
        ["collection_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_dashboards_collection_id", "dashboards", ["collection_id"])
    op.create_index("ix_dashboards_is_favorite", "dashboards", ["is_favorite"])
    op.create_index("ix_dashboards_last_opened_at", "dashboards", ["last_opened_at"])

    # Backfill tags from config.tags when present (config may be json)
    op.execute(
        """
        UPDATE dashboards
        SET tags = COALESCE((config::jsonb)->'tags', '[]'::jsonb)
        WHERE config IS NOT NULL
          AND jsonb_typeof(COALESCE((config::jsonb)->'tags', 'null'::jsonb)) = 'array'
        """
    )


def downgrade() -> None:
    op.drop_index("ix_dashboards_last_opened_at", table_name="dashboards")
    op.drop_index("ix_dashboards_is_favorite", table_name="dashboards")
    op.drop_index("ix_dashboards_collection_id", table_name="dashboards")
    op.drop_constraint("fk_dashboards_collection_id", "dashboards", type_="foreignkey")
    op.drop_column("dashboards", "tags")
    op.drop_column("dashboards", "last_opened_at")
    op.drop_column("dashboards", "is_favorite")
    op.drop_column("dashboards", "collection_id")
    op.drop_index("ix_dashboard_collections_parent_id", table_name="dashboard_collections")
    op.drop_index("ix_dashboard_collections_project_id", table_name="dashboard_collections")
    op.drop_index("ix_dashboard_collections_user_id", table_name="dashboard_collections")
    op.drop_table("dashboard_collections")
