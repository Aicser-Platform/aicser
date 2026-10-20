"""Master data entities (match and merge)

Revision ID: 2026_10_17_master_entities
Revises: 2026_10_17_domain_org
Create Date: 2026-10-17
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "2026_10_17_master_entities"
down_revision: Union[str, None] = "2026_10_17_domain_org"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    jsonb = postgresql.JSONB()
    op.create_table(
        "master_entities",
        sa.Column("id", uuid, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("organization_id", uuid, nullable=True),
        sa.Column("project_id", uuid, nullable=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sources", jsonb, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("rules", jsonb, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("survivorship", jsonb, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("decisions", jsonb, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("output", jsonb, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_by", uuid, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.current_timestamp()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=True, server_default=sa.text("true")),
        sa.Column("is_deleted", sa.Boolean(), nullable=True, server_default=sa.text("false")),
    )
    op.create_index("ix_master_entities_id", "master_entities", ["id"])
    op.create_index("ix_master_entities_organization_id", "master_entities", ["organization_id"])
    op.create_index("ix_master_entities_project_id", "master_entities", ["project_id"])


def downgrade() -> None:
    op.drop_table("master_entities")
