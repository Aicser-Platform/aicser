"""Widen users.avatar_url from VARCHAR(255) to TEXT.

CE stores profile avatars as base64 WebP data URIs directly in the database
instead of uploading to Azure Blob Storage. A 256×256 WebP at quality 85 is
roughly 15-30 KB which, when base64-encoded, exceeds VARCHAR(255).
"""
from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "2026_07_08_avatar_url_text"
down_revision = "2026_07_07_ce_query_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(text("ALTER TABLE users ALTER COLUMN avatar_url TYPE TEXT"))


def downgrade() -> None:
    # Truncate any data URIs before narrowing back — they would exceed 255 chars.
    op.execute(text("UPDATE users SET avatar_url = NULL WHERE length(avatar_url) > 255"))
    op.execute(text("ALTER TABLE users ALTER COLUMN avatar_url TYPE VARCHAR(255)"))
