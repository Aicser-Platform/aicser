"""Actions: destinations for results, and the record of every send

Revision ID: 2026_10_17_actions
Revises: 2026_10_17_master_entities
Create Date: 2026-10-17
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "2026_10_17_actions"
down_revision: Union[str, None] = "2026_10_17_master_entities"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _base():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.current_timestamp()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=True, server_default=sa.text("true")),
        sa.Column("is_deleted", sa.Boolean(), nullable=True, server_default=sa.text("false")),
    ]


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    jsonb = postgresql.JSONB()
    op.create_table(
        "action_destinations",
        sa.Column("id", uuid, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("organization_id", uuid, nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("settings", jsonb, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("secret", sa.Text(), nullable=True),
        sa.Column("created_by", uuid, nullable=True),
        *_base(),
    )
    op.create_index("ix_action_destinations_id", "action_destinations", ["id"])
    op.create_index("ix_action_destinations_organization_id", "action_destinations", ["organization_id"])
    op.create_table(
        "action_sends",
        sa.Column("id", uuid, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("organization_id", uuid, nullable=False),
        sa.Column("destination_id", uuid, nullable=False),
        sa.Column("user_id", uuid, nullable=True),
        sa.Column("title", sa.String(300), nullable=True),
        sa.Column("source", jsonb, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("row_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("status", sa.String(20), nullable=False, server_default=sa.text("'sent'")),
        sa.Column("error", sa.Text(), nullable=True),
        *_base(),
    )
    op.create_index("ix_action_sends_id", "action_sends", ["id"])
    op.create_index("ix_action_sends_organization_id", "action_sends", ["organization_id"])
    op.create_index("ix_action_sends_destination_id", "action_sends", ["destination_id"])


def downgrade() -> None:
    op.drop_table("action_sends")
    op.drop_table("action_destinations")
