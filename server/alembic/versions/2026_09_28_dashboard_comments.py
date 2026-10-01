"""Saved dashboard comments: threads on a dashboard or a widget, resolvable."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "2026_09_28_dashboard_comments"
down_revision = "2026_09_27_ml_model_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dashboard_comments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("dashboard_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("dashboards.id", ondelete="CASCADE"), nullable=False),
        sa.Column("widget_id", sa.String(128), nullable=True),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("dashboard_comments.id", ondelete="CASCADE"), nullable=True),
        sa.Column("author_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("author_name", sa.String(255), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_dashboard_comments_dashboard", "dashboard_comments", ["dashboard_id", "created_at"])
    op.create_index("ix_dashboard_comments_parent", "dashboard_comments", ["parent_id"])
    op.create_index("ix_dashboard_comments_author", "dashboard_comments", ["author_id", "created_at"])


def downgrade() -> None:
    op.drop_table("dashboard_comments")
