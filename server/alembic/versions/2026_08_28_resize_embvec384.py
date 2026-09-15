"""resize_embedding_vector_to_384

Revision ID: 2026_08_28_resize_embvec384
Revises: 2026_08_27_project_is_default
Create Date: 2026-08-28

document_chunks.embedding_vector was a fixed vector(1536) column, sized for
OpenAI's text-embedding-3-small -- the only embedding path this system
supported when the column was added. embedding_service.py now defaults to
local sentence-transformers (BAAI/bge-small-en-v1.5, 384 dimensions), which
the ingestion write path correctly refuses to write into a 1536-wide column
(dimension mismatch guard in _embed_and_store), so every chunk embedded
under the new default silently never got a fast ANN-indexed vector -- always
falling back to the O(n) JSONB linear scan, regardless of knowledge-base
size.

Confirmed live before writing this migration: every document_chunks row in
this database (258/258) has NULL embedding and NULL embedding_vector -- the
write path had been broken (see the transaction-poisoning bug fixed
alongside this) since before any embeddings, at any dimension, were ever
successfully stored. There is nothing at 1536 dimensions to preserve.

pgvector has no ALTER-in-place for a vector column's width; the practical
fix is to drop and recreate the column and its ANN index at the new width.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "2026_08_28_resize_embvec384"
down_revision: Union[str, None] = "2026_08_27_project_is_default"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_DIMENSIONS = 384


def _pgvector_ready(connection) -> bool:
    return bool(
        connection.execute(
            sa.text(
                "SELECT EXISTS ("
                "  SELECT 1 FROM pg_extension WHERE extname = 'vector'"
                ") AND EXISTS ("
                "  SELECT 1 FROM information_schema.columns "
                "  WHERE table_name = 'document_chunks' AND column_name = 'embedding_vector'"
                ")"
            )
        ).scalar()
    )


def upgrade() -> None:
    conn = op.get_bind()
    if not _pgvector_ready(conn):
        return

    op.execute("DROP INDEX IF EXISTS ix_document_chunks_embedding_vector")
    op.execute("ALTER TABLE document_chunks DROP COLUMN IF EXISTS embedding_vector")
    op.execute(f"ALTER TABLE document_chunks ADD COLUMN embedding_vector vector({NEW_DIMENSIONS})")
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_document_chunks_embedding_vector
        ON document_chunks
        USING ivfflat (embedding_vector vector_cosine_ops)
        WITH (lists = 100);
        """
    )
    # Any JSONB embedding stored at the new width can go straight into the
    # ANN column -- covers chunks embedded locally before this migration ran.
    op.execute(
        f"""
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
          AND jsonb_array_length(embedding) = {NEW_DIMENSIONS};
        """
    )


def downgrade() -> None:
    conn = op.get_bind()
    if not _pgvector_ready(conn):
        return

    op.execute("DROP INDEX IF EXISTS ix_document_chunks_embedding_vector")
    op.execute("ALTER TABLE document_chunks DROP COLUMN IF EXISTS embedding_vector")
    op.execute("ALTER TABLE document_chunks ADD COLUMN embedding_vector vector(1536)")
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_document_chunks_embedding_vector
        ON document_chunks
        USING ivfflat (embedding_vector vector_cosine_ops)
        WITH (lists = 100);
        """
    )
