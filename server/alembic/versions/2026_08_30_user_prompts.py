"""Add user_prompts table (Prompt Library CRUD)."""
import os
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


def _is_ee_enabled() -> bool:
    edition = os.getenv("AISER_EDITION", "community").strip().lower()
    return edition in {"enterprise", "ee"} or bool(os.getenv("AISER_EDITION_LICENSE_KEY", "").strip())


revision: str = "c3d4e5f6a8b9"
down_revision: Union[str, None] = "2026_08_28_resize_embvec384"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if not _is_ee_enabled():
        return

    op.create_table(
        "user_prompts",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("tag", sa.String(length=32), server_default="chat", nullable=True),
        sa.Column("is_shared", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_prompts_user_id", "user_prompts", ["user_id"])
    op.create_index("ix_user_prompts_organization_id", "user_prompts", ["organization_id"])


def downgrade() -> None:
    if not _is_ee_enabled():
        return

    op.drop_index("ix_user_prompts_organization_id", table_name="user_prompts")
    op.drop_index("ix_user_prompts_user_id", table_name="user_prompts")
    op.drop_table("user_prompts")
