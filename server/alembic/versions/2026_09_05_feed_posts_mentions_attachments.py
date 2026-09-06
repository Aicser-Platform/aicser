"""Feed: pure text posts (asset_type=post), @mentions on posts, multi-attachment table."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "2026_09_05_feed_post_mentions"
down_revision = "2026_09_04_oauth_connector"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE asset_type_enum ADD VALUE IF NOT EXISTS 'post'")

    op.add_column(
        "feed_posts",
        sa.Column("mentions", postgresql.ARRAY(postgresql.UUID(as_uuid=True)), nullable=True),
    )

    # create_type=False: the explicit .create() call below is the sole
    # creator - without this, op.create_table()'s own column-type DDL
    # visiting tries to CREATE TYPE a second time and fails with
    # DuplicateObject even though the explicit create() used checkfirst=True
    # (that flag only guards the explicit call, not create_table's implicit one).
    feed_attachment_asset_type_enum = postgresql.ENUM(
        "dashboard", "chart", name="feed_attachment_asset_type_enum", create_type=False
    )
    feed_attachment_asset_type_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "feed_post_attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "post_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("feed_posts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("asset_type", feed_attachment_asset_type_enum, nullable=False),
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("post_id", "asset_type", "asset_id", name="uq_feed_post_attachment"),
    )
    op.create_index("idx_feed_post_attachments_post", "feed_post_attachments", ["post_id"])


def downgrade() -> None:
    op.drop_index("idx_feed_post_attachments_post", table_name="feed_post_attachments")
    op.drop_table("feed_post_attachments")
    op.execute("DROP TYPE IF EXISTS feed_attachment_asset_type_enum")
    op.drop_column("feed_posts", "mentions")
    # PostgreSQL enum values cannot be removed safely in downgrade.
