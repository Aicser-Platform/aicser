"""Feed snapshot thumbnail_url — static screenshot preview for feed cards."""
from alembic import op
import sqlalchemy as sa

revision = "i7d8e9f0a1b2"
down_revision = "h6c7d8e9f0a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "feed_snapshots",
        sa.Column("thumbnail_url", sa.String(length=1024), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("feed_snapshots", "thumbnail_url")
