"""Deprecated metrics: still answer existing charts, no longer offered to Ask.

Revision ID: 2026_11_01_metric_lifecycle
Revises: 2026_10_31_asset_revisions
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "2026_11_01_metric_lifecycle"
down_revision: Union[str, None] = "2026_10_31_asset_revisions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("semantic_metrics", sa.Column("deprecated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("semantic_metrics", sa.Column("replaced_by", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("semantic_metrics", "replaced_by")
    op.drop_column("semantic_metrics", "deprecated_at")
