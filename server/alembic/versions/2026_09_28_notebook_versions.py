"""Notebook version history: code snapshots (no outputs) to browse and restore."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "2026_09_28_notebook_versions"
down_revision = "2026_09_28_dashboard_comments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notebook_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("notebook_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("notebooks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("notebook_version", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("cells", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("author_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("reason", sa.String(20), nullable=False, server_default="save"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_notebook_versions_nb", "notebook_versions", ["notebook_id", "updated_at"])


def downgrade() -> None:
    op.drop_table("notebook_versions")
