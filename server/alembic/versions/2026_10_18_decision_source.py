"""AI decisions remember their data and where their answers go

``source``: the connection, query and columns a decision reads (set by its last run).
``output``: the dataset its answers are saved to, and how often it runs again.

Revision ID: 2026_10_18_decision_source
Revises: 2026_10_18_fold_bm_measures
Create Date: 2026-10-18
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "2026_10_18_decision_source"
down_revision: Union[str, None] = "2026_10_18_fold_bm_measures"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table("ai_decision_definitions"):
        return
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("ai_decision_definitions")}
    if "source" not in cols:
        op.add_column("ai_decision_definitions", sa.Column("source", JSONB, nullable=True))
    if "output" not in cols:
        op.add_column("ai_decision_definitions", sa.Column("output", JSONB, nullable=True))


def downgrade() -> None:
    if not _has_table("ai_decision_definitions"):
        return
    op.drop_column("ai_decision_definitions", "output")
    op.drop_column("ai_decision_definitions", "source")
