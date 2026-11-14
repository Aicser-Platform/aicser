"""Releases between projects (dev to prod), reviewed before they apply

Revision ID: 2026_11_01_promotion_requests
Revises: 2026_11_01_metric_lifecycle
Create Date: 2026-11-01
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "2026_11_01_promotion_requests"
down_revision: Union[str, None] = "2026_11_01_metric_lifecycle"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    jsonb = postgresql.JSONB()
    op.create_table(
        "promotion_requests",
        sa.Column("id", uuid, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("organization_id", uuid, nullable=False),
        sa.Column("source", jsonb, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("target_project_id", uuid, nullable=False),
        sa.Column("bundle", jsonb, nullable=False),
        sa.Column("connection_map", jsonb, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("plan", jsonb, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("requested_by", uuid, nullable=False),
        sa.Column("decided_by", uuid, nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("result", jsonb, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.current_timestamp()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=True, server_default=sa.text("true")),
        sa.Column("is_deleted", sa.Boolean(), nullable=True, server_default=sa.text("false")),
    )
    op.create_index("ix_promotion_requests_organization_id", "promotion_requests", ["organization_id"])
    op.create_index("ix_promotion_requests_target_project_id", "promotion_requests", ["target_project_id"])


def downgrade() -> None:
    op.drop_table("promotion_requests")
