"""fix_charts_uuid_pk

Revision ID: c7d8e9f0a1b2
Revises: b3c4d5e6f7a8
Create Date: 2026-05-20

"""
from typing import Sequence, Union

from alembic import op


revision: str = "c7d8e9f0a1b2"
down_revision: Union[str, None] = "b3c4d5e6f7a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'charts'
                  AND column_name = 'id'
                  AND data_type = 'integer'
            ) THEN
                ALTER TABLE charts DROP CONSTRAINT IF EXISTS charts_pkey;
                DROP INDEX IF EXISTS ix_charts_id;

                ALTER TABLE charts ADD COLUMN id_uuid uuid DEFAULT gen_random_uuid();
                UPDATE charts SET id_uuid = gen_random_uuid() WHERE id_uuid IS NULL;
                ALTER TABLE charts ALTER COLUMN id_uuid SET NOT NULL;
                ALTER TABLE charts DROP COLUMN id;
                ALTER TABLE charts RENAME COLUMN id_uuid TO id;
                ALTER TABLE charts ADD PRIMARY KEY (id);
                CREATE UNIQUE INDEX IF NOT EXISTS ix_charts_id ON charts (id);
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    # There is no safe reversible mapping from generated UUIDs back to the old
    # integer ids. Keep downgrade as a no-op to avoid data loss.
    pass
