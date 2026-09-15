"""Add conversation_id to llm_audit_log and llm_request_summary for per-conversation cost attribution."""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "2026_08_23_llm_conv_id"
down_revision: Union[str, Sequence[str], None] = "2026_08_20_column_security"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "llm_audit_log",
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index(
        "ix_llm_audit_log_conversation_id", "llm_audit_log", ["conversation_id"]
    )
    op.create_foreign_key(
        "fk_llm_audit_log_conversation_id",
        "llm_audit_log",
        "conversation",
        ["conversation_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.add_column(
        "llm_request_summary",
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index(
        "ix_llm_request_summary_conversation_id", "llm_request_summary", ["conversation_id"]
    )
    op.create_foreign_key(
        "fk_llm_request_summary_conversation_id",
        "llm_request_summary",
        "conversation",
        ["conversation_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_llm_request_summary_conversation_id", "llm_request_summary", type_="foreignkey"
    )
    op.drop_index("ix_llm_request_summary_conversation_id", table_name="llm_request_summary")
    op.drop_column("llm_request_summary", "conversation_id")

    op.drop_constraint(
        "fk_llm_audit_log_conversation_id", "llm_audit_log", type_="foreignkey"
    )
    op.drop_index("ix_llm_audit_log_conversation_id", table_name="llm_audit_log")
    op.drop_column("llm_audit_log", "conversation_id")
