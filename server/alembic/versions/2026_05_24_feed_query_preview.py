"""Feed query asset type and preview metadata."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "2026_05_24_feed_query_preview"
down_revision = "b9c0d1e2f3a4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE asset_type_enum ADD VALUE IF NOT EXISTS 'query'")
    op.add_column(
        "feed_posts",
        sa.Column("preview_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("feed_posts", "preview_metadata")
