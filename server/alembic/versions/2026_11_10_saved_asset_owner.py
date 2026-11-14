"""Saved chat assets record who saved them, so reads and deletes can be limited to that person.

Existing assets take their conversation's owner. Assets with no conversation (query-editor charts)
stay without an owner and are no longer listed to anyone.
"""

from alembic import op

revision = "2026_11_10_saved_asset_owner"
down_revision = "2026_11_05_seat_extras"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE IF EXISTS saved_asset ADD COLUMN IF NOT EXISTS user_id UUID")
    op.execute("CREATE INDEX IF NOT EXISTS ix_saved_asset_user_id ON saved_asset (user_id)")
    op.execute("""
        DO $$
        BEGIN
            IF to_regclass('public.saved_asset') IS NOT NULL AND to_regclass('public.conversation') IS NOT NULL THEN
                UPDATE saved_asset a SET user_id = c.user_id
                FROM conversation c
                WHERE a.conversation_id = c.id AND a.user_id IS NULL AND c.user_id IS NOT NULL;
            END IF;
        END $$;
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_saved_asset_user_id")
    op.execute("ALTER TABLE IF EXISTS saved_asset DROP COLUMN IF EXISTS user_id")
