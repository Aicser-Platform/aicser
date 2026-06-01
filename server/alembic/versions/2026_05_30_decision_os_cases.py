"""Add decision_cases and decision_evidence_items tables."""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d1e2f3a4b5c6"
down_revision: Union[str, Sequence[str], None] = "c0d1e2f3a4b5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "decision_cases",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("conversation_id", sa.String(), nullable=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("title", sa.String(length=512), nullable=True),
        sa.Column("status", sa.String(length=32), server_default="open", nullable=False),
        sa.Column("domain_pack_id", sa.String(length=64), nullable=True),
        sa.Column("decision_brief", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("confidence_score", sa.Float(), nullable=True),
        sa.Column("hitl_required", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("audit_trail", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("workflow_state", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["organizations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_decision_cases_conversation_id", "decision_cases", ["conversation_id"])
    op.create_index("ix_decision_cases_hitl_required", "decision_cases", ["hitl_required"])

    op.create_table(
        "decision_evidence_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("case_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("ref_id", sa.String(), nullable=True),
        sa.Column("extraction_summary", sa.Text(), nullable=True),
        sa.Column("citations", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.ForeignKeyConstraint(["case_id"], ["decision_cases.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_decision_evidence_items_case_id", "decision_evidence_items", ["case_id"])


def downgrade() -> None:
    op.drop_index("ix_decision_evidence_items_case_id", table_name="decision_evidence_items")
    op.drop_table("decision_evidence_items")
    op.drop_index("ix_decision_cases_hitl_required", table_name="decision_cases")
    op.drop_index("ix_decision_cases_conversation_id", table_name="decision_cases")
    op.drop_table("decision_cases")
