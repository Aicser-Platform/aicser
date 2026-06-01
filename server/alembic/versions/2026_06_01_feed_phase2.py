"""Feed Phase 2: referral tracking on views, follow/publish notification types."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "h6c7d8e9f0a1"
down_revision = "g5b6c7d8e9f0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("feed_views", sa.Column("referral_code", sa.String(length=100), nullable=True))
    op.add_column("feed_views", sa.Column("referrer_user_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_feed_views_referrer_user",
        "feed_views",
        "users",
        ["referrer_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("idx_feed_views_referrer", "feed_views", ["referrer_user_id"])

    op.execute("ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'follow'")
    op.execute("ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'publish'")


def downgrade() -> None:
    op.drop_index("idx_feed_views_referrer", table_name="feed_views")
    op.drop_constraint("fk_feed_views_referrer_user", "feed_views", type_="foreignkey")
    op.drop_column("feed_views", "referrer_user_id")
    op.drop_column("feed_views", "referral_code")
    # PostgreSQL enum values cannot be removed safely in downgrade.
