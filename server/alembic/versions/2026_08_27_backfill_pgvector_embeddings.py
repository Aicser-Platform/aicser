"""backfill_pgvector_embeddings

Revision ID: c1a2b3d4e5f6
Revises: 4b1c78653f5d
Create Date: 2026-08-27

Every document_chunks row ingested since migration 2026_05_23_pgvector_embeddings
(which only backfilled embedding_vector once, at migration time) has had
embedding_vector permanently NULL -- the write path never set it going forward,
silently collapsing retrieval to a full linear JSONB scan. The write path is
now fixed (src/modules/knowledge/services/document_ingestion_service.py); this
re-runs the same backfill UPDATE the original migration used to catch up
everything ingested since. Idempotent and safe to run repeatedly: only touches
rows where embedding_vector is still NULL.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c1a2b3d4e5f6"
down_revision: Union[str, None] = "4b1c78653f5d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


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


def downgrade() -> None:
    # No-op: this only fills in previously-NULL values from data that's still
    # present in the JSONB `embedding` column, nothing to reverse.
    pass
