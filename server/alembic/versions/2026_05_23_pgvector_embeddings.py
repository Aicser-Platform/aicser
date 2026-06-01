"""pgvector_embeddings

Revision ID: d4e5f6a7b8c9
Revises: c7d8e9f0a1b2
Create Date: 2026-05-23

Adds optional pgvector column for document_chunks embeddings.
Skips cleanly when pgvector is unavailable (JSONB-only deployments).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, None] = "c7d8e9f0a1b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _pgvector_available(connection) -> bool:
    """Check extension availability without issuing a failing SQL statement."""
    return bool(
        connection.execute(
            sa.text(
                "SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector')"
            )
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
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'document_chunks'
                  AND column_name = 'embedding_vector'
            ) THEN
                ALTER TABLE document_chunks
                    ADD COLUMN embedding_vector vector(1536);
            END IF;
        END $$;
        """
    )

    op.execute(
        """
        UPDATE document_chunks
        SET embedding_vector = (
            '[' || array_to_string(
                ARRAY(SELECT jsonb_array_elements_text(embedding)),
                ','
            ) || ']'
        )::vector
        WHERE embedding IS NOT NULL
          AND embedding_vector IS NULL
          AND jsonb_typeof(embedding) = 'array'
          AND jsonb_array_length(embedding) = 1536;
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_document_chunks_embedding_vector
        ON document_chunks
        USING ivfflat (embedding_vector vector_cosine_ops)
        WITH (lists = 100);
        """
    )


def downgrade() -> None:
    conn = op.get_bind()
    if not _pgvector_available(conn):
        return

    op.execute("DROP INDEX IF EXISTS ix_document_chunks_embedding_vector")
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'document_chunks'
                  AND column_name = 'embedding_vector'
            ) THEN
                ALTER TABLE document_chunks DROP COLUMN embedding_vector;
            END IF;
        END $$;
        """
    )
