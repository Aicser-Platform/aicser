"""Add org-owned data-source access grants and RLS policies."""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql

revision: str = "2026_08_14_org_ds_access"
down_revision: Union[str, Sequence[str], None] = "2026_08_11_password_reset_tokens"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def _columns(table_name: str) -> set[str]:
    return {col["name"] for col in inspect(op.get_bind()).get_columns(table_name)}


def upgrade() -> None:
    tables = _tables()

    if "organization_id" not in _columns("data_sources"):
        op.add_column(
            "data_sources",
            sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        )
        op.create_index("ix_data_sources_organization_id", "data_sources", ["organization_id"])

    if "projects" in tables and "project_id" in _columns("data_sources"):
        op.execute(
            """
            UPDATE data_sources AS ds
            SET organization_id = p.organization_id
            FROM projects AS p
            WHERE ds.project_id = p.id
              AND ds.organization_id IS NULL
            """
        )

    op.create_table(
        "data_source_rls_policies",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("data_source_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("default_deny", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "settings",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("current_timestamp"),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("current_timestamp"),
            nullable=True,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=True),
        sa.ForeignKeyConstraint(["data_source_id"], ["data_sources.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("data_source_id", "name", name="uq_data_source_rls_policy_name"),
    )
    op.create_index("ix_data_source_rls_policies_data_source_id", "data_source_rls_policies", ["data_source_id"])
    op.create_index("ix_data_source_rls_policies_id", "data_source_rls_policies", ["id"])
    op.create_index("ix_data_source_rls_policies_organization_id", "data_source_rls_policies", ["organization_id"])
    op.create_index(
        "ix_data_source_rls_policies_source_enabled",
        "data_source_rls_policies",
        ["data_source_id", "enabled"],
    )

    op.create_table(
        "data_source_rls_rules",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("policy_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("table_name", sa.String(length=255), nullable=False),
        sa.Column("column_name", sa.String(length=255), nullable=False),
        sa.Column(
            "operator",
            sa.Enum("eq", "in", "not_in", "between", "is_null", "is_not_null", name="data_source_rls_operator_enum"),
            nullable=False,
        ),
        sa.Column(
            "value_type",
            sa.Enum("fixed", "user_attribute", "group_attribute", "org_attribute", "project_attribute", name="data_source_rls_value_type_enum"),
            nullable=False,
        ),
        sa.Column("value", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("current_timestamp"),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("current_timestamp"),
            nullable=True,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=True),
        sa.ForeignKeyConstraint(["policy_id"], ["data_source_rls_policies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_data_source_rls_rules_id", "data_source_rls_rules", ["id"])
    op.create_index("ix_data_source_rls_rules_policy_id", "data_source_rls_rules", ["policy_id"])
    op.create_index("ix_data_source_rls_rules_policy_table", "data_source_rls_rules", ["policy_id", "table_name"])

    op.create_table(
        "data_source_access_grants",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("data_source_id", sa.String(), nullable=False),
        sa.Column(
            "grantee_type",
            sa.Enum("project", "user", "group", "org_role", "project_role", name="data_source_grantee_type_enum"),
            nullable=False,
        ),
        sa.Column("grantee_id", sa.String(length=255), nullable=False),
        sa.Column(
            "permissions",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("rls_policy_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("current_timestamp"),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("current_timestamp"),
            nullable=True,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=True),
        sa.ForeignKeyConstraint(["data_source_id"], ["data_sources.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["rls_policy_id"], ["data_source_rls_policies.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("data_source_id", "grantee_type", "grantee_id", name="uq_data_source_access_grant_grantee"),
    )
    op.create_index("ix_data_source_access_grants_data_source_id", "data_source_access_grants", ["data_source_id"])
    op.create_index("ix_data_source_access_grants_grantee_id", "data_source_access_grants", ["grantee_id"])
    op.create_index("ix_data_source_access_grants_id", "data_source_access_grants", ["id"])
    op.create_index("ix_data_source_access_grants_organization_id", "data_source_access_grants", ["organization_id"])
    op.create_index(
        "ix_data_source_access_grants_org_grantee",
        "data_source_access_grants",
        ["organization_id", "grantee_type", "grantee_id"],
    )

    if "projects" in tables and "project_id" in _columns("data_sources"):
        op.execute(
            """
            INSERT INTO data_source_access_grants (
                organization_id,
                data_source_id,
                grantee_type,
                grantee_id,
                permissions,
                created_by,
                created_at,
                updated_at,
                is_active,
                is_deleted
            )
            SELECT
                ds.organization_id,
                ds.id,
                'project',
                ds.project_id::text,
                '["view", "query", "edit", "manage"]'::jsonb,
                ds.user_id,
                current_timestamp,
                current_timestamp,
                true,
                false
            FROM data_sources AS ds
            WHERE ds.project_id IS NOT NULL
              AND ds.organization_id IS NOT NULL
            ON CONFLICT ON CONSTRAINT uq_data_source_access_grant_grantee DO NOTHING
            """
        )


def downgrade() -> None:
    bind = op.get_bind()

    op.drop_index("ix_data_source_access_grants_org_grantee", table_name="data_source_access_grants")
    op.drop_index("ix_data_source_access_grants_organization_id", table_name="data_source_access_grants")
    op.drop_index("ix_data_source_access_grants_id", table_name="data_source_access_grants")
    op.drop_index("ix_data_source_access_grants_grantee_id", table_name="data_source_access_grants")
    op.drop_index("ix_data_source_access_grants_data_source_id", table_name="data_source_access_grants")
    op.drop_table("data_source_access_grants")

    op.drop_index("ix_data_source_rls_rules_policy_table", table_name="data_source_rls_rules")
    op.drop_index("ix_data_source_rls_rules_policy_id", table_name="data_source_rls_rules")
    op.drop_index("ix_data_source_rls_rules_id", table_name="data_source_rls_rules")
    op.drop_table("data_source_rls_rules")

    op.drop_index("ix_data_source_rls_policies_source_enabled", table_name="data_source_rls_policies")
    op.drop_index("ix_data_source_rls_policies_organization_id", table_name="data_source_rls_policies")
    op.drop_index("ix_data_source_rls_policies_id", table_name="data_source_rls_policies")
    op.drop_index("ix_data_source_rls_policies_data_source_id", table_name="data_source_rls_policies")
    op.drop_table("data_source_rls_policies")

    if "organization_id" in _columns("data_sources"):
        op.drop_index("ix_data_sources_organization_id", table_name="data_sources")
        op.drop_column("data_sources", "organization_id")

    sa.Enum(name="data_source_grantee_type_enum").drop(bind, checkfirst=True)
    sa.Enum(name="data_source_rls_value_type_enum").drop(bind, checkfirst=True)
    sa.Enum(name="data_source_rls_operator_enum").drop(bind, checkfirst=True)
