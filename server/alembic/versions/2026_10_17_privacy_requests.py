"""Privacy requests (erasure and access)

Revision ID: 2026_10_17_privacy_requests
Revises: 2026_10_17_actions
Create Date: 2026-10-17
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "2026_10_17_privacy_requests"
down_revision: Union[str, None] = "2026_10_17_actions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    jsonb = postgresql.JSONB()
    op.create_table(
        "privacy_requests",
        sa.Column("id", uuid, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("organization_id", uuid, nullable=False),
        sa.Column("kind", sa.String(10), nullable=False, server_default=sa.text("'erase'")),
        sa.Column("identifier_type", sa.String(20), nullable=False),
        sa.Column("subject_secret", sa.Text(), nullable=False),
        sa.Column("subject_hint", sa.String(120), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default=sa.text("'open'")),
        sa.Column("findings", jsonb, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("values_secret", sa.Text(), nullable=True),
        sa.Column("results", jsonb, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("requested_by", uuid, nullable=True),
        sa.Column("closed_by", uuid, nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.current_timestamp()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=True, server_default=sa.text("true")),
        sa.Column("is_deleted", sa.Boolean(), nullable=True, server_default=sa.text("false")),
    )
    op.create_index("ix_privacy_requests_id", "privacy_requests", ["id"])
    op.create_index("ix_privacy_requests_organization_id", "privacy_requests", ["organization_id"])


def downgrade() -> None:
    op.drop_table("privacy_requests")
