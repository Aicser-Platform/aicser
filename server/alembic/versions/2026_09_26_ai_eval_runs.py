"""AI answer-accuracy runs (golden set pass rate history for the AI Quality page)."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "2026_09_26_ai_eval_runs"
down_revision = "2026_09_26_chart_owner_backfill"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_eval_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("trigger", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("questions", sa.Integer(), nullable=True),
        sa.Column("accuracy", sa.Float(), nullable=True),
        sa.Column("mode_accuracy", sa.Float(), nullable=True),
        sa.Column("p50_s", sa.Float(), nullable=True),
        sa.Column("p95_s", sa.Float(), nullable=True),
        sa.Column("report", postgresql.JSONB(), nullable=True),
        sa.Column("failures", postgresql.JSONB(), nullable=True),
        sa.Column("error", sa.String(500), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_ai_eval_runs_started_at", "ai_eval_runs", ["started_at"])


def downgrade() -> None:
    op.drop_table("ai_eval_runs")
