"""Aicser Agent live experience: streamed text, mid-task messages, created outputs

``agent_runs.draft``: the text the model is writing right now (streamed to the page).
``agent_runs.inbox``: messages the person sent while the task runs; taken in at the next step.
``agent_runs.outputs``: what the task created (charts, dashboards, files), shown as cards.

Revision ID: 2026_10_26_agent_live
Revises: 2026_10_25_agent_skills
Create Date: 2026-10-26
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "2026_10_26_agent_live"
down_revision: Union[str, None] = "2026_10_25_agent_skills"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_EMPTY_LIST = sa.text("'[]'::jsonb")


def upgrade() -> None:
    bind = op.get_bind()
    if "agent_runs" not in set(sa.inspect(bind).get_table_names()):
        return
    cols = {c["name"] for c in sa.inspect(bind).get_columns("agent_runs")}
    if "draft" not in cols:
        op.add_column("agent_runs", sa.Column("draft", sa.Text, nullable=True))
    if "inbox" not in cols:
        op.add_column("agent_runs", sa.Column("inbox", JSONB, nullable=False, server_default=_EMPTY_LIST))
    if "outputs" not in cols:
        op.add_column("agent_runs", sa.Column("outputs", JSONB, nullable=False, server_default=_EMPTY_LIST))


def downgrade() -> None:
    bind = op.get_bind()
    if "agent_runs" not in set(sa.inspect(bind).get_table_names()):
        return
    cols = {c["name"] for c in sa.inspect(bind).get_columns("agent_runs")}
    for col in ("outputs", "inbox", "draft"):
        if col in cols:
            op.drop_column("agent_runs", col)
