"""Create plugin_enablements table for Plug-in enablement gate.

Revision ID: 2026_10_31_plugin_enablements
Revises: 2026_10_22_recipe_cleaning
Create Date: 2026-10-31
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "2026_10_31_plugin_enablements"
down_revision: Union[str, None] = "2026_10_22_recipe_cleaning"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "plugin_enablements",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("scope_key", sa.String(length=128), nullable=False),
        sa.Column("plugin_id", sa.String(length=64), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("config_encrypted", sa.Text(), nullable=True),
        sa.Column("updated_by_user_id", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("scope_key", "plugin_id", name="uq_plugin_enablement_scope_plugin"),
    )
    op.create_index("ix_plugin_enablements_scope_key", "plugin_enablements", ["scope_key"])
    op.create_index("ix_plugin_enablements_plugin_id", "plugin_enablements", ["plugin_id"])


def downgrade() -> None:
    op.drop_index("ix_plugin_enablements_plugin_id", table_name="plugin_enablements")
    op.drop_index("ix_plugin_enablements_scope_key", table_name="plugin_enablements")
    op.drop_table("plugin_enablements")

