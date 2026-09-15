"""Feed attachments: allow attaching already-published insights.

Extends feed_attachment_asset_type_enum with 'insight' so a text post can
reference an existing insight publication the same way it already references
dashboards and charts.
"""
from alembic import op

revision = "2026_09_09_feed_attach_insight"
down_revision = "2026_09_05_feed_attach_ref_post"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE feed_attachment_asset_type_enum ADD VALUE IF NOT EXISTS 'insight'")


def downgrade() -> None:
    # PostgreSQL cannot cheaply drop an enum value; leave it in place.
    pass
