"""Enforce unique collection names within scope (chart + dashboard libraries).

Industry default: folder names unique per project (EE) or per user (CE).
Deletes already unlink children (SET NULL) — this only adds uniqueness.

Revision id kept <= 32 chars for alembic_version.version_num.
"""
from __future__ import annotations

from alembic import op

revision = "2026_07_26_coll_name_uq"
down_revision = "2026_07_26_dashboard_library"
branch_labels = None
depends_on = None


def _dedupe(table: str) -> None:
    """Rename duplicate names within the same scope so unique indexes can apply."""
    op.execute(
        f"""
        WITH ranked AS (
            SELECT
                id,
                name,
                ROW_NUMBER() OVER (
                    PARTITION BY
                        COALESCE(project_id::text, ''),
                        COALESCE(user_id::text, ''),
                        lower(trim(name))
                    ORDER BY created_at NULLS LAST, id
                ) AS rn
            FROM {table}
        )
        UPDATE {table} AS t
        SET name = ranked.name || ' (' || ranked.rn || ')'
        FROM ranked
        WHERE t.id = ranked.id
          AND ranked.rn > 1
        """
    )


def upgrade() -> None:
    _dedupe("chart_collections")
    _dedupe("dashboard_collections")

    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_chart_collections_project_name
        ON chart_collections (project_id, lower(trim(name)))
        WHERE project_id IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_chart_collections_user_name
        ON chart_collections (user_id, lower(trim(name)))
        WHERE project_id IS NULL AND user_id IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_dashboard_collections_project_name
        ON dashboard_collections (project_id, lower(trim(name)))
        WHERE project_id IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_dashboard_collections_user_name
        ON dashboard_collections (user_id, lower(trim(name)))
        WHERE project_id IS NULL AND user_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_dashboard_collections_user_name")
    op.execute("DROP INDEX IF EXISTS uq_dashboard_collections_project_name")
    op.execute("DROP INDEX IF EXISTS uq_chart_collections_user_name")
    op.execute("DROP INDEX IF EXISTS uq_chart_collections_project_name")
