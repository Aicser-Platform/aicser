"""Feed publication snapshots — render_mode and feed_snapshots table."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "f4a5b6c7d8e9"
down_revision = "f3a4b5c6d7e8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    render_mode_enum = postgresql.ENUM("snapshot", "live", name="feed_render_mode_enum", create_type=True)
    render_mode_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "feed_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("post_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("payload_hash", sa.String(length=64), nullable=True),
        sa.Column("byte_size", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("filter_state", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("captured_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["post_id"], ["feed_posts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("post_id", "version", name="uq_feed_snapshots_post_version"),
    )
    op.create_index("idx_feed_snapshots_post", "feed_snapshots", ["post_id"])

    op.add_column(
        "feed_posts",
        sa.Column(
            "render_mode",
            render_mode_enum,
            server_default=sa.text("'live'"),
            nullable=False,
        ),
    )
    op.add_column(
        "feed_posts",
        sa.Column("current_snapshot_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "feed_posts",
        sa.Column("snapshot_version", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.create_index("idx_feed_posts_current_snapshot", "feed_posts", ["current_snapshot_id"])

    op.create_table(
        "feed_chat_drafts",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("conversation_id", sa.String(length=255), nullable=False),
        sa.Column("message_id", sa.String(length=255), nullable=False),
        sa.Column("draft", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "conversation_id", "message_id", name="uq_feed_chat_drafts_user_message"),
    )


def downgrade() -> None:
    op.drop_table("feed_chat_drafts")
    op.drop_index("idx_feed_posts_current_snapshot", table_name="feed_posts")
    op.drop_column("feed_posts", "snapshot_version")
    op.drop_column("feed_posts", "current_snapshot_id")
    op.drop_column("feed_posts", "render_mode")
    op.drop_index("idx_feed_snapshots_post", table_name="feed_snapshots")
    op.drop_table("feed_snapshots")
    op.execute("DROP TYPE IF EXISTS feed_render_mode_enum")
