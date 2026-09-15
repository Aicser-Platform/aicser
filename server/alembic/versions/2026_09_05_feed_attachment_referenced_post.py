"""Feed: feed_post_attachments.referenced_post_id - an attachment now points at a
real feed publication (auto-published on attach if the dashboard/chart wasn't
published yet), so it always has a working deep link and a real preview
instead of trying to reconstruct one against the raw dashboard/chart id."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "2026_09_05_feed_attach_ref_post"
down_revision = "2026_09_05_feed_post_edited"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "feed_post_attachments",
        sa.Column("referenced_post_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_feed_post_attachments_referenced_post_id",
        "feed_post_attachments",
        "feed_posts",
        ["referenced_post_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_feed_post_attachments_referenced_post_id",
        "feed_post_attachments",
        ["referenced_post_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_feed_post_attachments_referenced_post_id", table_name="feed_post_attachments")
    op.drop_constraint(
        "fk_feed_post_attachments_referenced_post_id", "feed_post_attachments", type_="foreignkey"
    )
    op.drop_column("feed_post_attachments", "referenced_post_id")
