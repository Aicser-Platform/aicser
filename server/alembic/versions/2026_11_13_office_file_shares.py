"""Docs and Slides sharing (people and view links, approved by organization owners / admins) and phone remotes."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "2026_11_13_office_file_shares"
down_revision = "2026_11_13_office_files"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "office_file_shares",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("file_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("office_files.id", ondelete="CASCADE"), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("target", sa.String(10), nullable=False),
        sa.Column("person_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("role", sa.String(10), nullable=False, server_default="view"),
        sa.Column("slug", sa.String(24), nullable=True),
        sa.Column("link_access", sa.String(16), nullable=True),
        sa.Column("status", sa.String(10), nullable=False, server_default="pending"),
        sa.Column("requested_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("decided_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("note", sa.String(300), nullable=True),
        sa.Column("view_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.current_timestamp()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true")),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false")),
        sa.CheckConstraint("target IN ('person', 'link')", name="ck_office_file_shares_target"),
        sa.CheckConstraint("role IN ('view', 'edit')", name="ck_office_file_shares_role"),
    )
    op.create_index("ix_office_file_shares_id", "office_file_shares", ["id"])
    op.create_index("ix_office_file_shares_file_id", "office_file_shares", ["file_id"])
    op.create_index("ix_office_file_shares_organization_id", "office_file_shares", ["organization_id"])
    op.create_index("ix_office_file_shares_person_id", "office_file_shares", ["person_id"])
    op.create_index("ix_office_file_shares_slug", "office_file_shares", ["slug"], unique=True)
    op.create_index("ix_office_file_shares_org_status", "office_file_shares", ["organization_id", "status"])

    op.create_table(
        "office_remote_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("file_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("office_files.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("state", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("commands", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("seq", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("phone_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_office_remote_sessions_file_id", "office_remote_sessions", ["file_id"])
    op.create_index("ix_office_remote_sessions_token_hash", "office_remote_sessions", ["token_hash"], unique=True)


def downgrade() -> None:
    op.drop_table("office_remote_sessions")
    op.drop_table("office_file_shares")
