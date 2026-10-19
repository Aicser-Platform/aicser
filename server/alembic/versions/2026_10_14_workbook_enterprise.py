"""Workbook enterprise: settings and audit (parity with notebooks)."""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "2026_10_14_workbook_enterprise"
down_revision: Union[str, None] = "2026_10_14_notebook_enterprise"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    op.add_column(
        "workbooks",
        sa.Column("settings", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.create_table(
        "workbook_audit_events",
        sa.Column("id", uuid, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("workbook_id", uuid, sa.ForeignKey("workbooks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", uuid, nullable=True),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("metadata", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_workbook_audit_wb", "workbook_audit_events", ["workbook_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_workbook_audit_wb", table_name="workbook_audit_events")
    op.drop_table("workbook_audit_events")
    op.drop_column("workbooks", "settings")
