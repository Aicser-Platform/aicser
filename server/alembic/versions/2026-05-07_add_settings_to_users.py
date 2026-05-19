"""add_settings_to_users

Revision ID: b3c4d5e6f7a8
Revises: 4aa4ed67bea3
Create Date: 2026-05-07 10:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'b3c4d5e6f7a8'
down_revision: Union[str, None] = '4aa4ed67bea3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS settings JSONB"
    )


def downgrade() -> None:
    op.drop_column('users', 'settings')
