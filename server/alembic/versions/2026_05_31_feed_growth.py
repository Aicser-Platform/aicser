"""Feed growth: multi-post per asset, digest subscriptions."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "g5b6c7d8e9f0"
down_revision = "f4a5b6c7d8e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("uq_feed_posts_asset", "feed_posts", type_="unique")
    op.create_index("idx_feed_posts_asset", "feed_posts", ["asset_type", "asset_id"], unique=False)

    op.create_table(
        "feed_digest_subscriptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("unsubscribe_token", sa.String(length=64), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email", name="uq_feed_digest_subscriptions_email"),
        sa.UniqueConstraint("unsubscribe_token", name="uq_feed_digest_subscriptions_token"),
    )
    op.create_index("idx_feed_digest_subscriptions_active", "feed_digest_subscriptions", ["is_active"])


def downgrade() -> None:
    op.drop_index("idx_feed_digest_subscriptions_active", table_name="feed_digest_subscriptions")
    op.drop_table("feed_digest_subscriptions")
    op.drop_index("idx_feed_posts_asset", table_name="feed_posts")
    op.create_unique_constraint("uq_feed_posts_asset", "feed_posts", ["asset_type", "asset_id"])
