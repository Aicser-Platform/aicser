"""AI Decisions user tool: definitions, runs and per-distinct-text results."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "2026_09_24_ai_decisions_tool"
down_revision = "2026_09_24_platform_api_keys"
branch_labels = None
depends_on = None

_UUID = postgresql.UUID(as_uuid=True)
_JSONB = postgresql.JSONB(astext_type=sa.Text())
_NOW = sa.text("CURRENT_TIMESTAMP")


def upgrade() -> None:
    op.create_table(
        "ai_decision_definitions",
        sa.Column("id", _UUID, server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("organization_id", _UUID, nullable=True),
        sa.Column("project_id", _UUID, nullable=True),
        sa.Column("created_by", _UUID, nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("question_type", sa.String(16), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=False),
        sa.Column("criteria", _JSONB, server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("threshold", sa.Float(), server_default=sa.text("0.85"), nullable=False),
        sa.Column("allow_raw_text", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_decision_definitions_org", "ai_decision_definitions", ["organization_id"])

    op.create_table(
        "ai_decision_runs",
        sa.Column("id", _UUID, server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("definition_id", _UUID, sa.ForeignKey("ai_decision_definitions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("definition_version", sa.Integer(), nullable=False),
        sa.Column("organization_id", _UUID, nullable=True),
        sa.Column("created_by", _UUID, nullable=False),
        sa.Column("data_source_id", sa.String(64), nullable=False),
        sa.Column("source_sql", sa.Text(), nullable=False),
        sa.Column("text_columns", _JSONB, nullable=False),
        sa.Column("status", sa.String(16), server_default=sa.text("'queued'"), nullable=False),
        sa.Column("row_count", sa.Integer(), nullable=True),
        sa.Column("distinct_count", sa.Integer(), nullable=True),
        sa.Column("processed", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("needs_review", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("backend", sa.String(16), nullable=True),
        sa.Column("cost", sa.Float(), server_default=sa.text("0"), nullable=False),
        sa.Column("review_case_id", _UUID, nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_decision_runs_definition", "ai_decision_runs", ["definition_id"])

    op.create_table(
        "ai_decision_results",
        sa.Column("id", _UUID, server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("run_id", _UUID, sa.ForeignKey("ai_decision_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("text_key", sa.String(64), nullable=False),
        sa.Column("input_text", sa.Text(), nullable=False),
        sa.Column("row_count", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("value", sa.String(128), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("band", sa.String(16), nullable=True),
        sa.Column("source", sa.String(16), nullable=True),
        sa.Column("reviewed_value", sa.String(128), nullable=True),
        sa.Column("reviewed_by", _UUID, nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "text_key", name="uq_ai_decision_results_run_text"),
    )


def downgrade() -> None:
    op.drop_table("ai_decision_results")
    op.drop_index("ix_ai_decision_runs_definition", table_name="ai_decision_runs")
    op.drop_table("ai_decision_runs")
    op.drop_index("ix_ai_decision_definitions_org", table_name="ai_decision_definitions")
    op.drop_table("ai_decision_definitions")
