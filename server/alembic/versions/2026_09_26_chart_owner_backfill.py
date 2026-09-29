"""Give charts created on a dashboard an owner and a project.

Charts added through the dashboard charts API were saved with no user_id and no project_id, so
the chart library (which authorises by owner or project) refused them to everyone: they could
be used on their dashboard but never edited, moved or deleted from the library. Each such chart
takes the project and creator of the first dashboard it was placed on. Charts on no dashboard
are left alone: nothing says whose they are.

Also merges the two heads (feed post images, embed assistant branding) into one.
"""
from alembic import op

revision = "2026_09_26_chart_owner_backfill"
down_revision = ("2026_09_24_feed_post_images", "embedasstbrand")
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE charts AS c
        SET project_id = COALESCE(c.project_id, first_place.project_id),
            user_id = COALESCE(c.user_id, first_place.created_by)
        FROM (
            SELECT DISTINCT ON (dc.chart_id) dc.chart_id, d.project_id, d.created_by
            FROM dashboard_charts dc
            JOIN dashboards d ON d.id = dc.dashboard_id
            WHERE d.project_id IS NOT NULL
            ORDER BY dc.chart_id, dc.created_at ASC NULLS LAST
        ) AS first_place
        WHERE c.id = first_place.chart_id
          AND c.user_id IS NULL
          AND c.project_id IS NULL
        """
    )


def downgrade() -> None:
    # Data backfill only: the previous NULLs carried no information worth restoring.
    pass
