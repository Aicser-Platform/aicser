"""Docs and Slides: documents and presentations edited in the browser (editor JSON in ``body``)."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "2026_11_13_office_files"
down_revision = "2026_11_10_saved_asset_owner"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "office_files",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("body", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("meta", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("visibility", sa.String(20), nullable=False, server_default="private"),
        sa.Column("folder_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("asset_folders.id", ondelete="SET NULL"), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.current_timestamp()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true")),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false")),
        sa.CheckConstraint("kind IN ('document', 'presentation')", name="ck_office_files_kind"),
    )
    op.create_index("ix_office_files_id", "office_files", ["id"])
    op.create_index("ix_office_files_user_id", "office_files", ["user_id"])
    op.create_index("ix_office_files_organization_id", "office_files", ["organization_id"])
    op.create_index("ix_office_files_project_id", "office_files", ["project_id"])
    op.create_index("ix_office_files_folder_id", "office_files", ["folder_id"])
    op.create_index("ix_office_files_scope", "office_files", ["organization_id", "project_id", "kind", "visibility"])


def downgrade() -> None:
    op.drop_table("office_files")
