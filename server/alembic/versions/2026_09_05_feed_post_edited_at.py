"""Feed: edited_at on feed_posts, for editing a pure-text post (mirrors feed_comments.edited_at)."""
from alembic import op
import sqlalchemy as sa

revision = "2026_09_05_feed_post_edited"
down_revision = "2026_09_05_feed_post_mentions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "feed_posts",
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("feed_posts", "edited_at")
