"""pgvector on query_patterns for ANN retrieval.

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _pgvector_available(connection) -> bool:
    return bool(
        connection.execute(
            sa.text("SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector')")
        ).scalar()
    )


def upgrade() -> None:
    conn = op.get_bind()
    if not _pgvector_available(conn):
        return

    with op.get_context().autocommit_block():
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'query_patterns' AND column_name = 'embedding_vector'
            ) THEN
                ALTER TABLE query_patterns ADD COLUMN embedding_vector vector(1536);
            END IF;
        END $$;
        """
    )

    op.execute(
        """
        UPDATE query_patterns
        SET embedding_vector = (
            '[' || array_to_string(
                ARRAY(SELECT jsonb_array_elements_text(embedding::jsonb)),
                ','
            ) || ']'
        )::vector
        WHERE embedding IS NOT NULL
          AND embedding_vector IS NULL
          AND jsonb_typeof(embedding::jsonb) = 'array'
          AND jsonb_array_length(embedding::jsonb) = 1536;
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_query_patterns_embedding_vector
        ON query_patterns
        USING ivfflat (embedding_vector vector_cosine_ops)
        WITH (lists = 100);
        """
    )


def downgrade() -> None:
    conn = op.get_bind()
    if not _pgvector_available(conn):
        return
    op.execute("DROP INDEX IF EXISTS ix_query_patterns_embedding_vector")
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'query_patterns' AND column_name = 'embedding_vector'
            ) THEN
                ALTER TABLE query_patterns DROP COLUMN embedding_vector;
            END IF;
        END $$;
        """
    )
