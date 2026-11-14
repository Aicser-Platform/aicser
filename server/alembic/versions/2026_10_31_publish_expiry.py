"""Public publishing: expiry date and approval reminder on feed posts

Revision ID: 2026_10_31_publish_expiry
Revises: 2026_10_31_agent_docs_mcp
Create Date: 2026-10-31
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "2026_10_31_publish_expiry"
down_revision: Union[str, None] = "2026_10_31_agent_docs_mcp"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("feed_posts", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("feed_posts", sa.Column("approval_reminded_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("feed_posts", "approval_reminded_at")
    op.drop_column("feed_posts", "expires_at")
