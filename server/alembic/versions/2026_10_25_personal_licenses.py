"""Aicser Personal: one-time desktop licenses

``personal_licenses``: one Aicser Personal purchase per row — activation key (encrypted),
update period, device limit and the payments applied to it.

Revision ID: 2026_10_25_personal_licenses
Revises: 2026_10_24_agent_runs
Create Date: 2026-10-25
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "2026_10_25_personal_licenses"
down_revision: Union[str, None] = "2026_10_24_agent_runs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_EMPTY_LIST = sa.text("'[]'::jsonb")


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "personal_licenses" not in tables:
        op.create_table(
            "personal_licenses",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.current_timestamp()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.current_timestamp()),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("is_active", sa.Boolean, nullable=True, server_default=sa.text("true")),
            sa.Column("is_deleted", sa.Boolean, nullable=True, server_default=sa.text("false")),
            sa.Column("user_id", UUID(as_uuid=True), nullable=False),
            sa.Column("email", sa.String(320), nullable=True),
            sa.Column("status", sa.String(16), nullable=False, server_default=sa.text("'pending'")),
            sa.Column("license_id", sa.String(120), nullable=True),
            sa.Column("activation_key", sa.Text, nullable=True),
            sa.Column("updates_until", sa.DateTime(timezone=True), nullable=False),
            sa.Column("devices", sa.Integer, nullable=False, server_default=sa.text("3")),
            sa.Column("payments", JSONB, nullable=False, server_default=_EMPTY_LIST),
            sa.Column("last_error", sa.Text, nullable=True),
        )
        op.create_index("ix_personal_licenses_user_id", "personal_licenses", ["user_id"])
        op.create_index("ix_personal_licenses_license_id", "personal_licenses", ["license_id"])


def downgrade() -> None:
    if "personal_licenses" in set(sa.inspect(op.get_bind()).get_table_names()):
        op.drop_table("personal_licenses")
