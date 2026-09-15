"""Add content_hash to knowledge_documents for upload dedup.

RELIABILITY: ingest_document() had no way to detect "this exact file was
already uploaded to this data source" -- re-uploading the same PDF created a
second knowledge_documents row, re-parsed, re-chunked, and re-embedded the
identical content from scratch (real cost: local embedding CPU time, or a
metered API call per chunk for API-backed embedding providers), and left two
duplicate copies of every chunk permanently in retrieval results.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "kb31hash0001"
down_revision: Union[str, None] = "c3d4e5f6a8b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "knowledge_documents",
        sa.Column("content_hash", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ix_knowledge_documents_data_source_content_hash",
        "knowledge_documents",
        ["data_source_id", "content_hash"],
    )


def downgrade() -> None:
    op.drop_index("ix_knowledge_documents_data_source_content_hash", table_name="knowledge_documents")
    op.drop_column("knowledge_documents", "content_hash")
