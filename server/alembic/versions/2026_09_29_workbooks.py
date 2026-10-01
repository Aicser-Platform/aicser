"""Aicser Sheet: workbooks (IronCalc documents with live data ranges), history and comments."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "2026_09_29_workbooks"
down_revision = "2026_09_28_notebook_comments"
branch_labels = None
depends_on = None


def _ts():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    ]


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "workbooks",
        sa.Column("id", uuid, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("doc", sa.LargeBinary(), nullable=False),
        sa.Column("doc_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ranges", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("locale", sa.String(16), nullable=False, server_default="en"),
        sa.Column("timezone", sa.String(64), nullable=False, server_default="UTC"),
        sa.Column("user_id", uuid, nullable=False),
        sa.Column("organization_id", uuid, nullable=True),
        sa.Column("project_id", uuid, nullable=True),
        sa.Column("visibility", sa.String(20), nullable=False, server_default="private"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.now()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=True, server_default=sa.text("true")),
        sa.Column("is_deleted", sa.Boolean(), nullable=True, server_default=sa.text("false")),
    )
    op.create_index("ix_workbooks_user_id", "workbooks", ["user_id"])
    op.create_index("ix_workbooks_organization_id", "workbooks", ["organization_id"])
    op.create_index("ix_workbooks_project_id", "workbooks", ["project_id"])
    op.create_index("ix_workbooks_scope", "workbooks", ["organization_id", "project_id", "visibility"])
    op.create_table(
        "workbook_versions",
        sa.Column("id", uuid, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("workbook_id", uuid, sa.ForeignKey("workbooks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("workbook_version", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("doc", sa.LargeBinary(), nullable=False),
        sa.Column("ranges", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("author_id", uuid, nullable=False),
        sa.Column("reason", sa.String(20), nullable=False, server_default="save"),
        *_ts(),
    )
    op.create_index("ix_workbook_versions_wb", "workbook_versions", ["workbook_id", "updated_at"])
    op.create_table(
        "workbook_comments",
        sa.Column("id", uuid, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("workbook_id", uuid, sa.ForeignKey("workbooks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("cell_ref", sa.String(80), nullable=True),
        sa.Column("parent_id", uuid, sa.ForeignKey("workbook_comments.id", ondelete="CASCADE"), nullable=True),
        sa.Column("author_id", uuid, nullable=False),
        sa.Column("author_name", sa.String(255), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by", uuid, nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        *_ts(),
    )
    op.create_index("ix_workbook_comments_wb", "workbook_comments", ["workbook_id", "created_at"])


def downgrade() -> None:
    op.drop_table("workbook_comments")
    op.drop_table("workbook_versions")
    op.drop_table("workbooks")
