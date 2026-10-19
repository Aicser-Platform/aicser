"""Data contracts on certified tables

Revision ID: 2026_10_17_data_contracts
Revises: 2026_10_17_pipeline_names
Create Date: 2026-10-17
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "2026_10_17_data_contracts"
down_revision: Union[str, None] = "2026_10_17_pipeline_names"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    jsonb = postgresql.JSONB()
    op.create_table(
        "data_contracts",
        sa.Column("id", uuid, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("organization_id", uuid, nullable=True),
        sa.Column("data_source_id", sa.String(), sa.ForeignKey("data_sources.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_table", sa.String(), nullable=True),
        sa.Column("layer", sa.String(20), nullable=False, server_default=sa.text("'silver'")),
        sa.Column("columns", jsonb, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("min_rows", sa.Integer(), nullable=True),
        sa.Column("freshness_hours", sa.Integer(), nullable=True),
        sa.Column("on_breach", sa.String(10), nullable=False, server_default=sa.text("'warn'")),
        sa.Column("owner_id", uuid, nullable=True),
        sa.Column("created_by", uuid, nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_breaches", jsonb, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.current_timestamp()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=True, server_default=sa.text("true")),
        sa.Column("is_deleted", sa.Boolean(), nullable=True, server_default=sa.text("false")),
    )
    op.create_index("ix_data_contracts_id", "data_contracts", ["id"])
    op.create_index("ix_data_contracts_organization_id", "data_contracts", ["organization_id"])
    op.create_index("ix_data_contracts_data_source_id", "data_contracts", ["data_source_id"])
    op.create_index("ix_data_contracts_table", "data_contracts", ["data_source_id", "source_table", "layer"])


def downgrade() -> None:
    op.drop_table("data_contracts")
