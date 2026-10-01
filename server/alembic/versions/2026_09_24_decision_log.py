"""Decision layer log (ai_decision_log).

One row per typed decision asked of the decision layer (Jev / Laya): value, calibrated
probability, whether it was confident and used, and — in shadow mode — what the current
path decided, so rollout go/no-go and calibration are measured on real traffic.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "2026_09_24_decision_log"
down_revision = "2026_09_23_decision_os_base_cols"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_decision_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("question_set", sa.String(64), nullable=False),
        sa.Column("question_version", sa.Integer(), nullable=False),
        sa.Column("question_key", sa.String(64), nullable=False),
        sa.Column("backend", sa.String(16), nullable=False),
        sa.Column("mode", sa.String(16), nullable=False),
        sa.Column("value", sa.String(128), nullable=True),
        sa.Column("probability", sa.Float(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("confident", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("used", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("baseline_value", sa.String(128), nullable=True),
        sa.Column("agrees", sa.Boolean(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("cost", sa.Float(), nullable=True),
        sa.Column("error", sa.String(64), nullable=True),
        sa.Column("state_excerpt", sa.Text(), nullable=True),
        sa.Column("extra", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        # Policy band (act | surface | escalate) and the request it belongs to, so the answer's
        # outcome (quality gate, success, user feedback) can be joined back for calibration.
        sa.Column("band", sa.String(16), nullable=True),
        sa.Column("request_id", sa.String(64), nullable=True),
        sa.Column("outcome", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("outcome_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_decision_log_org", "ai_decision_log", ["organization_id"])
    op.create_index("ix_ai_decision_log_set_created", "ai_decision_log", ["question_set", "created_at"])
    op.create_index("ix_ai_decision_log_request", "ai_decision_log", ["request_id"])


def downgrade() -> None:
    op.drop_index("ix_ai_decision_log_request", table_name="ai_decision_log")
    op.drop_index("ix_ai_decision_log_set_created", table_name="ai_decision_log")
    op.drop_index("ix_ai_decision_log_org", table_name="ai_decision_log")
    op.drop_table("ai_decision_log")
