"""add_auth_columns_to_users

Revision ID: a1b2c3d4e5f6
Revises: 0079d06b6fed
Create Date: 2026-04-30

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '0079d06b6fed'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS hashed_password VARCHAR(255)")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS provider VARCHAR(20)")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS provider_user_id VARCHAR(255)")
    # Make user_id nullable only if it is currently NOT NULL
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='users' AND column_name='user_id'
                AND is_nullable='NO'
            ) THEN
                ALTER TABLE users ALTER COLUMN user_id DROP NOT NULL;
            END IF;
        END$$;
    """)


def downgrade() -> None:
    # WARNING: This will fail if any CE users exist (they have user_id=NULL).
    # Remove or backfill user_id on those rows before running downgrade.
    op.alter_column('users', 'user_id',
                    existing_type=postgresql.UUID(as_uuid=True),
                    existing_nullable=True,
                    nullable=False)
    op.drop_column('users', 'provider_user_id')
    op.drop_column('users', 'provider')
    op.drop_column('users', 'is_verified')
    op.drop_column('users', 'hashed_password')
