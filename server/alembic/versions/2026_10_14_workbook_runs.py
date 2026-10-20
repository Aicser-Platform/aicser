"""Workbook scheduled range refresh (schedules + runs)."""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "2026_10_14_workbook_runs"
down_revision: Union[str, None] = "2026_10_14_workbook_enterprise"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "workbook_schedules",
        sa.Column("id", uuid, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("workbook_id", uuid, sa.ForeignKey("workbooks.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("owner_id", uuid, nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("frequency", sa.String(16), nullable=False, server_default="daily"),
        sa.Column("hour", sa.Integer(), nullable=False, server_default="7"),
        sa.Column("minute", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("weekday", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("timezone", sa.String(64), nullable=False, server_default="UTC"),
        sa.Column("notify", sa.String(16), nullable=False, server_default="failure"),
        sa.Column("timeout_s", sa.Integer(), nullable=False, server_default="600"),
        sa.Column("run_parameters", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_status", sa.String(16), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_workbook_schedules_due", "workbook_schedules", ["enabled", "next_run_at"])
    op.create_table(
        "workbook_runs",
        sa.Column("id", uuid, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("workbook_id", uuid, sa.ForeignKey("workbooks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("owner_id", uuid, nullable=False),
        sa.Column("actor_user_id", uuid, nullable=True),
        sa.Column("trigger", sa.String(16), nullable=False, server_default="schedule"),
        sa.Column("status", sa.String(16), nullable=False, server_default="queued"),
        sa.Column("workbook_version", sa.Integer(), nullable=True),
        sa.Column("run_parameters", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("outputs", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_workbook_runs_wb", "workbook_runs", ["workbook_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_workbook_runs_wb", table_name="workbook_runs")
    op.drop_table("workbook_runs")
    op.drop_index("ix_workbook_schedules_due", table_name="workbook_schedules")
    op.drop_table("workbook_schedules")
