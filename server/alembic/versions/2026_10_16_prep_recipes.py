"""Prepare: versioned data-preparation recipes."""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "2026_10_16_prep_recipes"
down_revision: Union[str, None] = "2026_10_14_workbook_runs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    jsonb = postgresql.JSONB()
    op.create_table(
        "prep_recipes",
        sa.Column("id", uuid, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("user_id", uuid, nullable=False),
        sa.Column("organization_id", uuid, nullable=True),
        sa.Column("project_id", uuid, nullable=True),
        sa.Column("data_source_id", sa.String(), sa.ForeignKey("data_sources.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_table", sa.String(255), nullable=True),
        sa.Column("steps", jsonb, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output", jsonb, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.current_timestamp()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=True, server_default=sa.text("true")),
        sa.Column("is_deleted", sa.Boolean(), nullable=True, server_default=sa.text("false")),
    )
    op.create_index("ix_prep_recipes_user_id", "prep_recipes", ["user_id"])
    op.create_index("ix_prep_recipes_data_source_id", "prep_recipes", ["data_source_id"])
    op.create_index("ix_prep_recipes_scope", "prep_recipes", ["organization_id", "project_id"])
    op.create_table(
        "prep_recipe_versions",
        sa.Column("id", uuid, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("recipe_id", uuid, sa.ForeignKey("prep_recipes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("steps", jsonb, nullable=False),
        sa.Column("source_table", sa.String(255), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("author_id", uuid, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_prep_recipe_versions_recipe", "prep_recipe_versions", ["recipe_id", "version"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_prep_recipe_versions_recipe", table_name="prep_recipe_versions")
    op.drop_table("prep_recipe_versions")
    op.drop_index("ix_prep_recipes_scope", table_name="prep_recipes")
    op.drop_index("ix_prep_recipes_data_source_id", table_name="prep_recipes")
    op.drop_index("ix_prep_recipes_user_id", table_name="prep_recipes")
    op.drop_table("prep_recipes")
