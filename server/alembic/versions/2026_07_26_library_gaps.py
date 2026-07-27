"""Close library CRUD gaps: chart soft-delete, query collections.

- charts.is_deleted / deleted_at for trash/restore
- query_collections + saved_queries.collection_id (TEXT-scoped like saved_queries)
"""
from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "2026_07_26_library_gaps"
down_revision = "2026_07_26_coll_name_uq"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        text(
            """
            ALTER TABLE charts
              ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
              ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL
            """
        )
    )
    op.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_charts_is_deleted ON charts (is_deleted)"
        )
    )

    op.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS query_collections (
                id              SERIAL PRIMARY KEY,
                name            VARCHAR(255) NOT NULL,
                user_id         TEXT NOT NULL,
                organization_id TEXT,
                project_id      TEXT,
                sort_order      INTEGER NOT NULL DEFAULT 0,
                created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                updated_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    op.execute(
        text(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_query_collections_scope_name
            ON query_collections (
                user_id,
                COALESCE(organization_id, ''),
                COALESCE(project_id, ''),
                lower(trim(name))
            )
            """
        )
    )
    op.execute(
        text(
            """
            ALTER TABLE saved_queries
              ADD COLUMN IF NOT EXISTS collection_id INTEGER
              REFERENCES query_collections(id) ON DELETE SET NULL
            """
        )
    )
    op.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_saved_queries_collection_id ON saved_queries (collection_id)"
        )
    )


def downgrade() -> None:
    op.execute(text("DROP INDEX IF EXISTS ix_saved_queries_collection_id"))
    op.execute(text("ALTER TABLE saved_queries DROP COLUMN IF EXISTS collection_id"))
    op.execute(text("DROP INDEX IF EXISTS uq_query_collections_scope_name"))
    op.execute(text("DROP TABLE IF EXISTS query_collections"))
    op.execute(text("DROP INDEX IF EXISTS ix_charts_is_deleted"))
    op.execute(text("ALTER TABLE charts DROP COLUMN IF EXISTS deleted_at"))
    op.execute(text("ALTER TABLE charts DROP COLUMN IF EXISTS is_deleted"))
