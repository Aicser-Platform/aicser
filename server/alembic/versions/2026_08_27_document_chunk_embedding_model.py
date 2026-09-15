"""document_chunk_embedding_model

Revision ID: e2b3c4d5f6a7
Revises: c1a2b3d4e5f6
Create Date: 2026-08-27

Adds embedding_model/embedding_dims to document_chunks so a config-vs-stored
mismatch (EMBEDDING_MODEL or EMBEDDING_PROVIDER changed after chunks were
already embedded) can be detected instead of silently degrading retrieval.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e2b3c4d5f6a7"
down_revision: Union[str, None] = "c1a2b3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'document_chunks' AND column_name = 'embedding_model'
            ) THEN
                ALTER TABLE document_chunks ADD COLUMN embedding_model VARCHAR;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'document_chunks' AND column_name = 'embedding_dims'
            ) THEN
                ALTER TABLE document_chunks ADD COLUMN embedding_dims INTEGER;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE document_chunks DROP COLUMN IF EXISTS embedding_model")
    op.execute("ALTER TABLE document_chunks DROP COLUMN IF EXISTS embedding_dims")
