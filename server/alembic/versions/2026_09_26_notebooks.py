"""Notebooks: SQL, Python and text cells in one document."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "2026_09_26_notebooks"
down_revision = "2026_09_26_alert_watch"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notebooks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("cells", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("visibility", sa.String(20), nullable=False, server_default="private"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.current_timestamp()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true")),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false")),
    )
    op.create_index("ix_notebooks_id", "notebooks", ["id"])
    op.create_index("ix_notebooks_user_id", "notebooks", ["user_id"])
    op.create_index("ix_notebooks_organization_id", "notebooks", ["organization_id"])
    op.create_index("ix_notebooks_project_id", "notebooks", ["project_id"])
    op.create_index("ix_notebooks_scope", "notebooks", ["organization_id", "project_id", "visibility"])


def downgrade() -> None:
    op.drop_table("notebooks")
