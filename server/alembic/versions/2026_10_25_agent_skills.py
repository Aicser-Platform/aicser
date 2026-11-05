"""Aicser Agent: saved skills, org agents, schedules and run retention

``agent_skills``: saved, reusable tasks with inputs and an optional tool list.
``agent_org_agents``: agents the organization owns; each acts as a named member.
``agent_schedules``: skills or tasks that run on their own at set times.
``agent_org_policies.retention_days``: how long finished runs are kept.

Revision ID: 2026_10_25_agent_skills
Revises: 2026_10_25_personal_licenses
Create Date: 2026-10-25
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "2026_10_25_agent_skills"
down_revision: Union[str, None] = "2026_10_25_personal_licenses"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_EMPTY_OBJ = sa.text("'{}'::jsonb")
_EMPTY_LIST = sa.text("'[]'::jsonb")


def _uuid_pk() -> sa.Column:
    return sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()"))


def _stamps() -> list:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    ]


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())

    if "agent_skills" not in tables:
        op.create_table(
            "agent_skills",
            _uuid_pk(),
            sa.Column("organization_id", UUID(as_uuid=True), nullable=True),
            sa.Column("project_id", UUID(as_uuid=True), nullable=True),
            sa.Column("owner_id", UUID(as_uuid=True), nullable=False),
            sa.Column("scope", sa.String(16), nullable=False, server_default=sa.text("'user'")),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("description", sa.Text, nullable=True),
            sa.Column("instructions", sa.Text, nullable=False),
            sa.Column("inputs", JSONB, nullable=False, server_default=_EMPTY_LIST),
            sa.Column("pack", sa.String(32), nullable=True),
            sa.Column("tools", JSONB, nullable=False, server_default=_EMPTY_LIST),
            sa.Column("source_run_id", UUID(as_uuid=True), nullable=True),
            sa.Column("version", sa.Integer, nullable=False, server_default=sa.text("1")),
            sa.Column("run_count", sa.Integer, nullable=False, server_default=sa.text("0")),
            sa.Column("is_deleted", sa.Boolean, nullable=False, server_default=sa.text("false")),
            *_stamps(),
        )
        op.create_index("ix_agent_skills_organization_id", "agent_skills", ["organization_id"])
        op.create_index("ix_agent_skills_project_id", "agent_skills", ["project_id"])
        op.create_index("ix_agent_skills_owner_id", "agent_skills", ["owner_id"])

    if "agent_org_agents" not in tables:
        op.create_table(
            "agent_org_agents",
            _uuid_pk(),
            sa.Column("organization_id", UUID(as_uuid=True), nullable=False),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("purpose", sa.Text, nullable=True),
            sa.Column("owner_id", UUID(as_uuid=True), nullable=False),
            sa.Column("instructions", sa.Text, nullable=True),
            sa.Column("max_tier", sa.Integer, nullable=False, server_default=sa.text("2")),
            sa.Column("monthly_credit_cap", sa.Integer, nullable=False, server_default=sa.text("0")),
            sa.Column("status", sa.String(16), nullable=False, server_default=sa.text("'active'")),
            sa.Column("paused_reason", sa.Text, nullable=True),
            sa.Column("created_by", UUID(as_uuid=True), nullable=True),
            *_stamps(),
        )
        op.create_index("ix_agent_org_agents_organization_id", "agent_org_agents", ["organization_id"])
        op.create_index("ix_agent_org_agents_owner_id", "agent_org_agents", ["owner_id"])

    if "agent_schedules" not in tables:
        op.create_table(
            "agent_schedules",
            _uuid_pk(),
            sa.Column("organization_id", UUID(as_uuid=True), nullable=True),
            sa.Column("owner_id", UUID(as_uuid=True), nullable=False),
            sa.Column("org_agent_id", UUID(as_uuid=True), sa.ForeignKey("agent_org_agents.id", ondelete="CASCADE"), nullable=True),
            sa.Column("skill_id", UUID(as_uuid=True), sa.ForeignKey("agent_skills.id", ondelete="CASCADE"), nullable=True),
            sa.Column("goal", sa.Text, nullable=True),
            sa.Column("inputs", JSONB, nullable=False, server_default=_EMPTY_OBJ),
            sa.Column("project_id", UUID(as_uuid=True), nullable=True),
            sa.Column("data_source_id", sa.String(64), nullable=True),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.text("true")),
            sa.Column("frequency", sa.String(16), nullable=False, server_default=sa.text("'daily'")),
            sa.Column("hour", sa.Integer, nullable=False, server_default=sa.text("7")),
            sa.Column("minute", sa.Integer, nullable=False, server_default=sa.text("0")),
            sa.Column("weekday", sa.Integer, nullable=False, server_default=sa.text("0")),
            sa.Column("timezone", sa.String(64), nullable=False, server_default=sa.text("'UTC'")),
            sa.Column("notify", sa.String(16), nullable=False, server_default=sa.text("'always'")),
            sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_run_id", UUID(as_uuid=True), nullable=True),
            sa.Column("last_status", sa.String(300), nullable=True),
            *_stamps(),
        )
        op.create_index("ix_agent_schedules_organization_id", "agent_schedules", ["organization_id"])
        op.create_index("ix_agent_schedules_owner_id", "agent_schedules", ["owner_id"])
        op.create_index("ix_agent_schedules_org_agent_id", "agent_schedules", ["org_agent_id"])
        op.create_index("ix_agent_schedules_due", "agent_schedules", ["enabled", "next_run_at"])

    if "agent_org_policies" in tables:
        cols = {c["name"] for c in sa.inspect(bind).get_columns("agent_org_policies")}
        if "retention_days" not in cols:
            op.add_column("agent_org_policies",
                          sa.Column("retention_days", sa.Integer, nullable=False, server_default=sa.text("0")))


def downgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    for table in ("agent_schedules", "agent_org_agents", "agent_skills"):
        if table in tables:
            op.drop_table(table)
    if "agent_org_policies" in tables:
        cols = {c["name"] for c in sa.inspect(bind).get_columns("agent_org_policies")}
        if "retention_days" in cols:
            op.drop_column("agent_org_policies", "retention_days")
