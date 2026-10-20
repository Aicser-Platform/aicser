"""Proposed changes and published history for official metrics

Revision ID: 2026_10_18_metric_drafts
Revises: 2026_10_17_data_shares
Create Date: 2026-10-18
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "2026_10_18_metric_drafts"
down_revision: Union[str, None] = "2026_10_17_data_shares"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # An edit to an official metric waits here until someone publishes it; Ask keeps using the
    # published definition meanwhile. Each publish keeps the definition it replaced.
    op.add_column("semantic_metrics", sa.Column("pending_change", postgresql.JSONB(), nullable=True))
    op.add_column(
        "semantic_metrics",
        sa.Column("history", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
    )


def downgrade() -> None:
    op.drop_column("semantic_metrics", "history")
    op.drop_column("semantic_metrics", "pending_change")
