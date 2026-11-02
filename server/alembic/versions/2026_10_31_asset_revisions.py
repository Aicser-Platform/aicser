"""History for charts and alerts

Revision ID: 2026_10_31_asset_revisions
Revises: 2026_10_31_publish_expiry
Create Date: 2026-10-31
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision: str = "2026_10_31_asset_revisions"
down_revision: Union[str, None] = "2026_10_31_publish_expiry"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "asset_revisions",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("asset_type", sa.String(20), nullable=False),
        sa.Column("asset_id", sa.String(64), nullable=False, index=True),
        sa.Column("snapshot", pg.JSONB(), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("asset_revisions")
