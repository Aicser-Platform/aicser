"""Aicser Agent: recorded runs, steps and workspace artifacts; add-ons on subscriptions

``agent_runs``: one agent task — who asked, goal, status, budget, usage, live plan, result.
``agent_run_steps``: each model turn, tool call, approval and compaction of a run.
``agent_artifacts``: results kept in a run's workspace and passed between steps by handle.
``agent_memories``: what the agent remembers per person, project or organization.
``agent_org_policies``: per-organization pre-approvals, tier limits and device rules.
``agent_devices``: desktop apps that offer device tools to the agent.
``organization_subscriptions.addons``: add-ons bought on top of the plan (digital workers,
credit packs, self-hosted Agent seats).
``organization_seats``: each member's seat kind (AI or Light with their own model keys).

Revision ID: 2026_10_24_agent_runs
Revises: 2026_10_19_catalog_structure
Create Date: 2026-10-24
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "2026_10_24_agent_runs"
down_revision: Union[str, None] = "2026_10_19_catalog_structure"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_EMPTY_OBJ = sa.text("'{}'::jsonb")
_EMPTY_LIST = sa.text("'[]'::jsonb")


def _tables() -> set:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _columns(table: str) -> set:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    tables = _tables()
    if "organization_subscriptions" in tables and "addons" not in _columns("organization_subscriptions"):
        op.add_column(
            "organization_subscriptions",
            sa.Column("addons", JSONB, nullable=False, server_default=_EMPTY_OBJ),
        )

    if "organization_seats" not in tables and "organizations" in tables:
        op.create_table(
            "organization_seats",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.current_timestamp()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.current_timestamp()),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("is_active", sa.Boolean, nullable=True, server_default=sa.text("true")),
            sa.Column("is_deleted", sa.Boolean, nullable=True, server_default=sa.text("false")),
            sa.Column("organization_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", UUID(as_uuid=True), nullable=False),
            sa.Column("seat_type", sa.String(16), nullable=False, server_default=sa.text("'ai'")),
            sa.Column("assigned_by", UUID(as_uuid=True), nullable=True),
            sa.UniqueConstraint("organization_id", "user_id", name="uq_organization_seat_member"),
        )
        op.create_index("ix_organization_seats_organization_id", "organization_seats", ["organization_id"])
        op.create_index("ix_organization_seats_user_id", "organization_seats", ["user_id"])

    if "agent_runs" not in tables:
        op.create_table(
            "agent_runs",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("organization_id", UUID(as_uuid=True), nullable=True),
            sa.Column("project_id", UUID(as_uuid=True), nullable=True),
            sa.Column("user_id", UUID(as_uuid=True), nullable=False),
            sa.Column("conversation_id", sa.String(64), nullable=True),
            sa.Column("goal", sa.Text, nullable=False),
            sa.Column("status", sa.String(24), nullable=False, server_default=sa.text("'queued'")),
            sa.Column("trigger", sa.String(24), nullable=False, server_default=sa.text("'chat'")),
            sa.Column("unattended", sa.Boolean, nullable=False, server_default=sa.text("false")),
            sa.Column("agent_version", sa.String(32), nullable=False, server_default=sa.text("'1'")),
            sa.Column("budget", JSONB, nullable=False, server_default=_EMPTY_OBJ),
            sa.Column("usage", JSONB, nullable=False, server_default=_EMPTY_OBJ),
            sa.Column("plan", JSONB, nullable=False, server_default=_EMPTY_LIST),
            sa.Column("result", JSONB, nullable=True),
            sa.Column("error", sa.Text, nullable=True),
            sa.Column("approved_tools", JSONB, nullable=False, server_default=_EMPTY_LIST),
            sa.Column("untrusted_seen", sa.Boolean, nullable=False, server_default=sa.text("false")),
            sa.Column("messages", JSONB, nullable=False, server_default=_EMPTY_LIST),
            sa.Column("pending", JSONB, nullable=True),
            sa.Column("context", JSONB, nullable=False, server_default=_EMPTY_OBJ),
            sa.Column("feedback", JSONB, nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_agent_runs_organization_id", "agent_runs", ["organization_id"])
        op.create_index("ix_agent_runs_user_id", "agent_runs", ["user_id"])
        op.create_index("ix_agent_runs_conversation_id", "agent_runs", ["conversation_id"])
        op.create_index("ix_agent_runs_status", "agent_runs", ["status"])

    if "agent_run_steps" not in tables:
        op.create_table(
            "agent_run_steps",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("run_id", UUID(as_uuid=True), sa.ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False),
            sa.Column("seq", sa.Integer, nullable=False),
            sa.Column("kind", sa.String(16), nullable=False),
            sa.Column("tool_name", sa.String(120), nullable=True),
            sa.Column("tier", sa.Integer, nullable=True),
            sa.Column("args_hash", sa.String(64), nullable=True),
            sa.Column("args", JSONB, nullable=True),
            sa.Column("approval", JSONB, nullable=True),
            sa.Column("status", sa.String(16), nullable=False, server_default=sa.text("'ok'")),
            sa.Column("summary", sa.Text, nullable=True),
            sa.Column("result_handle", sa.String(64), nullable=True),
            sa.Column("error", sa.Text, nullable=True),
            sa.Column("model", sa.String(200), nullable=True),
            sa.Column("tokens_in", sa.Integer, nullable=True),
            sa.Column("tokens_out", sa.Integer, nullable=True),
            sa.Column("latency_ms", sa.Integer, nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("run_id", "seq", name="uq_agent_run_steps_run_seq"),
        )
        op.create_index("ix_agent_run_steps_run_id", "agent_run_steps", ["run_id"])

    if "agent_artifacts" not in tables:
        op.create_table(
            "agent_artifacts",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("run_id", UUID(as_uuid=True), sa.ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False),
            sa.Column("handle", sa.String(64), nullable=False),
            sa.Column("kind", sa.String(16), nullable=False),
            sa.Column("title", sa.String(300), nullable=True),
            sa.Column("tool_name", sa.String(120), nullable=True),
            sa.Column("preview", JSONB, nullable=True),
            sa.Column("payload", JSONB, nullable=True),
            sa.Column("size_bytes", sa.Integer, nullable=False, server_default=sa.text("0")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("run_id", "handle", name="uq_agent_artifacts_run_handle"),
        )
        op.create_index("ix_agent_artifacts_run_id", "agent_artifacts", ["run_id"])

    if "agent_org_policies" not in tables:
        op.create_table(
            "agent_org_policies",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("organization_id", UUID(as_uuid=True), nullable=False, unique=True),
            sa.Column("pre_approvals", JSONB, nullable=False, server_default=_EMPTY_OBJ),
            sa.Column("max_tier", JSONB, nullable=False, server_default=_EMPTY_OBJ),
            sa.Column("device", JSONB, nullable=False, server_default=_EMPTY_OBJ),
            sa.Column("version", sa.Integer, nullable=False, server_default=sa.text("1")),
            sa.Column("updated_by", UUID(as_uuid=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_agent_org_policies_organization_id", "agent_org_policies", ["organization_id"])

    if "agent_devices" not in tables:
        op.create_table(
            "agent_devices",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("organization_id", UUID(as_uuid=True), nullable=True),
            sa.Column("user_id", UUID(as_uuid=True), nullable=False),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("platform", sa.String(16), nullable=False),
            sa.Column("app_version", sa.String(40), nullable=True),
            sa.Column("capabilities", JSONB, nullable=False, server_default=_EMPTY_LIST),
            sa.Column("status", sa.String(16), nullable=False, server_default=sa.text("'active'")),
            sa.Column("policy_version", sa.Integer, nullable=True),
            sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_agent_devices_organization_id", "agent_devices", ["organization_id"])
        op.create_index("ix_agent_devices_user_id", "agent_devices", ["user_id"])

    if "agent_memories" not in tables:
        op.create_table(
            "agent_memories",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("organization_id", UUID(as_uuid=True), nullable=True),
            sa.Column("scope", sa.String(16), nullable=False),
            sa.Column("user_id", UUID(as_uuid=True), nullable=True),
            sa.Column("project_id", UUID(as_uuid=True), nullable=True),
            sa.Column("kind", sa.String(16), nullable=False, server_default=sa.text("'fact'")),
            sa.Column("content", sa.Text, nullable=False),
            sa.Column("embedding", sa.JSON, nullable=True),
            sa.Column("source_run_id", UUID(as_uuid=True), nullable=True),
            sa.Column("created_by", UUID(as_uuid=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
        for col in ("organization_id", "user_id", "project_id"):
            op.create_index(f"ix_agent_memories_{col}", "agent_memories", [col])


def downgrade() -> None:
    tables = _tables()
    for table in ("agent_devices", "agent_org_policies", "agent_memories", "agent_artifacts", "agent_run_steps",
                  "agent_runs", "organization_seats"):
        if table in tables:
            op.drop_table(table)
    if "organization_subscriptions" in tables and "addons" in _columns("organization_subscriptions"):
        op.drop_column("organization_subscriptions", "addons")
