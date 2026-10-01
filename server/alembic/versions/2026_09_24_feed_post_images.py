"""Images in feed posts (object-storage keys; bytes live in S3 / Azure / PostgreSQL storage)."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "2026_09_24_feed_post_images"
down_revision = "2026_09_24_org_sub_unique"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "feed_post_images",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("post_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("feed_posts.id", ondelete="CASCADE"), nullable=True),
        sa.Column("uploader_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column("content_type", sa.String(64), nullable=False, server_default=sa.text("'image/webp'")),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("alt_text", sa.String(300), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_feed_post_images_id", "feed_post_images", ["id"])
    op.create_index("ix_feed_post_images_post_id", "feed_post_images", ["post_id"])
    op.create_index("ix_feed_post_images_uploader_id", "feed_post_images", ["uploader_id"])
    op.create_index("ix_feed_post_images_organization_id", "feed_post_images", ["organization_id"])


def downgrade() -> None:
    op.drop_table("feed_post_images")
