"""Aicser Agent: organization opt-in for tuning examples from approved runs

``agent_org_policies.tuning_opt_in``: whether well-rated finished tasks may be exported as tuning
examples (personal data scrubbed).

Revision ID: 2026_10_27_agent_tuning
Revises: 2026_10_26_agent_live
Create Date: 2026-10-27
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "2026_10_27_agent_tuning"
down_revision: Union[str, None] = "2026_10_26_agent_live"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if "agent_org_policies" not in set(sa.inspect(bind).get_table_names()):
        return
    if "tuning_opt_in" not in {c["name"] for c in sa.inspect(bind).get_columns("agent_org_policies")}:
        op.add_column("agent_org_policies",
                      sa.Column("tuning_opt_in", sa.Boolean, nullable=False, server_default=sa.text("false")))


def downgrade() -> None:
    bind = op.get_bind()
    if "agent_org_policies" in set(sa.inspect(bind).get_table_names()) and \
            "tuning_opt_in" in {c["name"] for c in sa.inspect(bind).get_columns("agent_org_policies")}:
        op.drop_column("agent_org_policies", "tuning_opt_in")
