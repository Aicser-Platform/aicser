"""Add alert_rules and alert_events tables (EE alerts)."""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f7a8b9c0d1e2"
down_revision: Union[str, Sequence[str], None] = ("d4e5f6a7b8c0", "e1f2a3b4c5d6")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "alert_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("data_source_id", sa.String(), nullable=True),
        sa.Column("condition_sql", sa.Text(), nullable=False),
        sa.Column("threshold_operator", sa.String(length=16), server_default=">", nullable=False),
        sa.Column("threshold_value", sa.Float(), server_default="0", nullable=False),
        sa.Column("window_minutes", sa.Integer(), server_default="5", nullable=False),
        sa.Column("severity", sa.String(length=32), server_default="warning", nullable=False),
        sa.Column("channels", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("last_evaluated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_triggered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["data_source_id"], ["data_sources.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_alert_rules_org_id", "alert_rules", ["org_id"])
    op.create_index("ix_alert_rules_is_active", "alert_rules", ["is_active"])

    op.create_table(
        "alert_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("rule_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("triggered_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("evaluated_value", sa.Float(), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), server_default="firing", nullable=False),
        sa.ForeignKeyConstraint(["rule_id"], ["alert_rules.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_alert_events_rule_id", "alert_events", ["rule_id"])
    op.create_index("ix_alert_events_triggered_at", "alert_events", ["triggered_at"])


def downgrade() -> None:
    op.drop_index("ix_alert_events_triggered_at", table_name="alert_events")
    op.drop_index("ix_alert_events_rule_id", table_name="alert_events")
    op.drop_table("alert_events")
    op.drop_index("ix_alert_rules_is_active", table_name="alert_rules")
    op.drop_index("ix_alert_rules_org_id", table_name="alert_rules")
    op.drop_table("alert_rules")
