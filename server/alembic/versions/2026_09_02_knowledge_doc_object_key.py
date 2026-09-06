"""Add object_key to knowledge_documents for durable original-file storage.

RELIABILITY/PORTABILITY: uploaded knowledge-base documents (PDF/DOCX/MD/TXT)
were written straight to local disk (UPLOAD_DIR/knowledge/<uuid>.<ext>, a
Docker volume) with no column anywhere tracking where the file ended up --
the path was used once to feed DocumentIngestionService.ingest_document()
and then permanently orphaned (never deleted, never re-referenced), a pure
disk leak. This is also the only KB ingestion entry point that wrote to a
persistent location at all; every other caller correctly used an ephemeral
tempfile since they don't need the original kept around.

object_key routes original bytes through UploadDatasourceStorageService
instead (the same S3/Azure Blob/PostgreSQL-backed object storage
CSV/datasource uploads already use, selected via STORAGE_BACKEND), letting a
new GET /knowledge/documents/{id}/download endpoint retrieve the original
later. Nullable: existing documents ingested before this fix have no
durably-stored original to point at, and never will (nothing to backfill).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "kbdocobjkey01"
down_revision: Union[str, None] = "semcolclass1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "knowledge_documents",
        sa.Column("object_key", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("knowledge_documents", "object_key")
