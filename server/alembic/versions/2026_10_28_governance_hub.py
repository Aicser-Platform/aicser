"""Catalog hub and lakehouse grants

``catalog_follows``, ``catalog_threads`` (conversations and tasks), ``catalog_changes`` (change
history), ``catalog_quality_tests`` / ``catalog_quality_results`` (quality tests and their runs),
``catalog_incidents`` (the incident inbox) and ``iceberg_table_grants`` (who may read which Gold
tables through the Iceberg REST catalog).

Revision ID: 2026_10_28_governance_hub
Revises: 2026_10_28_template_chart_fix
Create Date: 2026-10-28
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "2026_10_28_governance_hub"
down_revision: Union[str, None] = "2026_10_28_template_chart_fix"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NOW = sa.func.now()


def _id() -> sa.Column:
    return sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()"))


def _org() -> sa.Column:
    return sa.Column("organization_id", UUID(as_uuid=True), nullable=False)


def _asset() -> list:
    return [sa.Column("asset_kind", sa.String(32), nullable=False), sa.Column("asset_ref", sa.String(512), nullable=False)]


def _ts(name: str, nullable: bool = False) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable, server_default=None if nullable else _NOW)


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())

    if "catalog_follows" not in tables:
        op.create_table("catalog_follows", _id(), _org(), *_asset(),
                        sa.Column("user_id", UUID(as_uuid=True), nullable=False), _ts("created_at"),
                        sa.UniqueConstraint("organization_id", "asset_kind", "asset_ref", "user_id", name="uq_catalog_follow"))
        op.create_index("ix_catalog_follows_user_id", "catalog_follows", ["user_id"])
        op.create_index("ix_catalog_follows_asset", "catalog_follows", ["organization_id", "asset_kind", "asset_ref"])

    if "catalog_threads" not in tables:
        op.create_table(
            "catalog_threads", _id(), _org(), *_asset(),
            sa.Column("column_name", sa.String(255), nullable=True),
            sa.Column("parent_id", UUID(as_uuid=True), nullable=True),
            sa.Column("kind", sa.String(12), nullable=False, server_default=sa.text("'comment'")),
            sa.Column("body", sa.Text, nullable=False),
            sa.Column("status", sa.String(12), nullable=False, server_default=sa.text("'open'")),
            sa.Column("assignee_user_id", UUID(as_uuid=True), nullable=True),
            _ts("due_at", True),
            sa.Column("author_id", UUID(as_uuid=True), nullable=False),
            sa.Column("resolved_by", UUID(as_uuid=True), nullable=True),
            _ts("resolved_at", True), _ts("deleted_at", True), _ts("created_at"), _ts("updated_at"),
        )
        op.create_index("ix_catalog_threads_asset", "catalog_threads", ["organization_id", "asset_kind", "asset_ref"])
        op.create_index("ix_catalog_threads_parent_id", "catalog_threads", ["parent_id"])
        op.create_index("ix_catalog_threads_assignee", "catalog_threads", ["assignee_user_id"])

    if "catalog_changes" not in tables:
        op.create_table("catalog_changes", _id(), _org(), *_asset(),
                        sa.Column("field", sa.String(64), nullable=False),
                        sa.Column("before", JSONB, nullable=True), sa.Column("after", JSONB, nullable=True),
                        sa.Column("changed_by", UUID(as_uuid=True), nullable=True), _ts("created_at"))
        op.create_index("ix_catalog_changes_asset", "catalog_changes", ["organization_id", "asset_kind", "asset_ref", "created_at"])

    if "catalog_quality_tests" not in tables:
        op.create_table(
            "catalog_quality_tests", _id(), _org(),
            sa.Column("project_id", UUID(as_uuid=True), nullable=True),
            sa.Column("data_source_id", sa.String, nullable=False),
            sa.Column("table_name", sa.String(512), nullable=False),
            sa.Column("column_name", sa.String(255), nullable=True),
            sa.Column("check_type", sa.String(24), nullable=False),
            sa.Column("params", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
            sa.Column("severity", sa.String(8), nullable=False, server_default=sa.text("'fail'")),
            sa.Column("schedule", sa.String(8), nullable=False, server_default=sa.text("'daily'")),
            sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.text("true")),
            sa.Column("created_by", UUID(as_uuid=True), nullable=False),
            _ts("last_run_at", True),
            sa.Column("last_status", sa.String(8), nullable=True),
            sa.Column("last_result", JSONB, nullable=True),
            _ts("deleted_at", True), _ts("created_at"), _ts("updated_at"),
        )
        op.create_index("ix_catalog_quality_tests_org", "catalog_quality_tests", ["organization_id"])
        op.create_index("ix_catalog_quality_tests_table", "catalog_quality_tests", ["data_source_id", "table_name"])

    if "catalog_quality_results" not in tables:
        op.create_table("catalog_quality_results", _id(),
                        sa.Column("test_id", UUID(as_uuid=True), nullable=False),
                        sa.Column("status", sa.String(8), nullable=False),
                        sa.Column("observed", JSONB, nullable=True), sa.Column("error", sa.Text, nullable=True),
                        sa.Column("duration_ms", sa.Float, nullable=True), _ts("ran_at"))
        op.create_index("ix_catalog_quality_results_test", "catalog_quality_results", ["test_id", "ran_at"])

    if "catalog_incidents" not in tables:
        op.create_table(
            "catalog_incidents", _id(), _org(), *_asset(),
            sa.Column("cause", sa.String(16), nullable=False),
            sa.Column("cause_id", sa.String(64), nullable=False),
            sa.Column("title", sa.String(300), nullable=False),
            sa.Column("detail", JSONB, nullable=True),
            sa.Column("severity", sa.String(8), nullable=False, server_default=sa.text("'fail'")),
            sa.Column("status", sa.String(12), nullable=False, server_default=sa.text("'open'")),
            sa.Column("assignee_user_id", UUID(as_uuid=True), nullable=True),
            sa.Column("occurrences", sa.Integer, nullable=False, server_default=sa.text("1")),
            _ts("first_seen"), _ts("last_seen"),
            sa.Column("resolved_by", UUID(as_uuid=True), nullable=True),
            _ts("resolved_at", True),
            sa.Column("resolution", sa.Text, nullable=True),
        )
        op.create_index("ix_catalog_incidents_org_status", "catalog_incidents", ["organization_id", "status"])
        op.create_index("ix_catalog_incidents_cause", "catalog_incidents", ["cause", "cause_id"])

    if "iceberg_table_grants" not in tables:
        op.create_table(
            "iceberg_table_grants", _id(), _org(),
            sa.Column("user_id", UUID(as_uuid=True), nullable=False),
            sa.Column("namespace", sa.String(255), nullable=False),
            sa.Column("table_name", sa.String(255), nullable=True),
            sa.Column("granted_by", UUID(as_uuid=True), nullable=True),
            _ts("expires_at", True),
            sa.Column("note", sa.Text, nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, server_default=_NOW),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True, server_default=_NOW),
            _ts("deleted_at", True),
            sa.Column("is_active", sa.Boolean, nullable=True, server_default=sa.text("true")),
            sa.Column("is_deleted", sa.Boolean, nullable=True, server_default=sa.text("false")),
        )
        op.create_index("ix_iceberg_table_grants_org_user", "iceberg_table_grants", ["organization_id", "user_id"])


def downgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    for name in ("iceberg_table_grants", "catalog_incidents", "catalog_quality_results", "catalog_quality_tests",
                 "catalog_changes", "catalog_threads", "catalog_follows"):
        if name in tables:
            op.drop_table(name)
