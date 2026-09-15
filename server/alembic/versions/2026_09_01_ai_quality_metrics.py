"""Add ai_quality_metrics table for AI response quality tracking.

Two real quality signals already computed on every analytics response —
response_finalizer_node's grounding/groundedness score (state["global_evaluation"],
mirrored into execution_metadata) and the agent kernel's goal-verification
pass/fail (state["verification_results"]) — were being calculated per-turn
and then discarded: neither was ever persisted anywhere queryable, so there
was no way to answer "how is AI quality trending for org X this week"
without a full JSONB scan of every message's ai_metadata blob. This table
gives those existing signals (plus thumbs feedback, already stored but never
joined against them) one small, indexed, purpose-built home for
aggregation — the write-side computation is unchanged, this only captures
what already runs on every request.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "aiqualmetric1"
down_revision: Union[str, None] = "kb31hash0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ai_quality_metrics",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("message.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("conversation.id", ondelete="CASCADE"), nullable=False),
        # Denormalized (not joined at query time) — this table exists specifically
        # for fast time-series aggregation by org/project, and neither is directly
        # on message/conversation (only reachable via conversation -> project ->
        # organization), which would make every dashboard query a 3-way join
        # across a much hotter table. Captured once, at write time, from state.
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("analytics_type", sa.String(length=50), nullable=True),
        sa.Column("analysis_mode", sa.String(length=50), nullable=True),
        # response_finalizer_node's global_evaluation["main"] — grounding/
        # groundedness score (0-1) and the decision it drove (approved /
        # needs_regeneration / degraded_pass / ...).
        sa.Column("grounding_score", sa.Float(), nullable=True),
        sa.Column("grounding_decision", sa.String(length=50), nullable=True),
        # Agent kernel's verify_goal/verify_goal_semantic — did the final plan
        # actually satisfy the stated goal (Auto mode's own definition of success,
        # independent of grounding).
        sa.Column("goal_verification_passed", sa.Boolean(), nullable=True),
        sa.Column("success", sa.Boolean(), nullable=True),
        sa.Column("critical_failure", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("had_error", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        # Updated later, out of band, when the user submits feedback on this
        # message (conversations/router.py's existing thumbs-up/down endpoint) —
        # nullable until then, not a separate row (one quality record per turn).
        sa.Column("thumbs_reaction", sa.String(length=10), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.current_timestamp()),
    )
    op.create_index(
        "ix_ai_quality_metrics_org_created",
        "ai_quality_metrics",
        ["organization_id", "created_at"],
    )
    op.create_index(
        "ix_ai_quality_metrics_org_mode_created",
        "ai_quality_metrics",
        ["organization_id", "analysis_mode", "created_at"],
    )
    op.create_index("ix_ai_quality_metrics_conversation_id", "ai_quality_metrics", ["conversation_id"])


def downgrade() -> None:
    op.drop_index("ix_ai_quality_metrics_conversation_id", table_name="ai_quality_metrics")
    op.drop_index("ix_ai_quality_metrics_org_mode_created", table_name="ai_quality_metrics")
    op.drop_index("ix_ai_quality_metrics_org_created", table_name="ai_quality_metrics")
    op.drop_table("ai_quality_metrics")
