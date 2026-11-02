"""LLM spend per organization and month, kept in Postgres

``org_llm_spend``: the month's AI spend for an organization (or a person without one), so the
budget hard limit can't be lifted by a cache flush. Redis keeps a read cache in front of it.

Revision ID: 2026_10_29_org_llm_spend
Revises: 2026_10_28_governance_hub
Create Date: 2026-10-29
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "2026_10_29_org_llm_spend"
down_revision: Union[str, None] = "2026_10_28_governance_hub"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if "org_llm_spend" in set(sa.inspect(op.get_bind()).get_table_names()):
        return
    op.create_table(
        "org_llm_spend",
        sa.Column("scope", sa.String(64), nullable=False),  # organization id, or user id without one
        sa.Column("month", sa.String(7), nullable=False),  # YYYY-MM (UTC)
        sa.Column("cost_usd", sa.Numeric(14, 6), nullable=False, server_default=sa.text("0")),
        sa.Column("calls", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("scope", "month", name="pk_org_llm_spend"),
    )


def downgrade() -> None:
    if "org_llm_spend" in set(sa.inspect(op.get_bind()).get_table_names()):
        op.drop_table("org_llm_spend")
