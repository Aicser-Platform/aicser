"""Scheduled notebook runs (Enterprise): schedules and run history."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "2026_09_29_notebook_runs"
down_revision = "2026_09_29_workbooks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "notebook_schedules",
        sa.Column("id", uuid, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("notebook_id", uuid, sa.ForeignKey("notebooks.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("owner_id", uuid, nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("frequency", sa.String(16), nullable=False, server_default="daily"),
        sa.Column("hour", sa.Integer(), nullable=False, server_default="7"),
        sa.Column("minute", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("weekday", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("timezone", sa.String(64), nullable=False, server_default="UTC"),
        sa.Column("notify", sa.String(16), nullable=False, server_default="failure"),
        sa.Column("timeout_s", sa.Integer(), nullable=False, server_default="600"),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_status", sa.String(16), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_notebook_schedules_due", "notebook_schedules", ["enabled", "next_run_at"])
    op.create_table(
        "notebook_runs",
        sa.Column("id", uuid, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("notebook_id", uuid, sa.ForeignKey("notebooks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("owner_id", uuid, nullable=False),
        sa.Column("trigger", sa.String(16), nullable=False, server_default="schedule"),
        sa.Column("status", sa.String(16), nullable=False, server_default="queued"),
        sa.Column("secret_hash", sa.String(64), nullable=True),
        sa.Column("notebook_version", sa.Integer(), nullable=True),
        sa.Column("outputs", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("failed_cell_id", sa.String(40), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_notebook_runs_nb", "notebook_runs", ["notebook_id", "created_at"])


def downgrade() -> None:
    op.drop_table("notebook_runs")
    op.drop_table("notebook_schedules")
