"""Add column-level security (CLS) policies and grant linkage."""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "2026_08_20_column_security"
down_revision: Union[str, Sequence[str], None] = "2026_08_14_lakehouse_meta"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "data_source_cls_policies",
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
        sa.UniqueConstraint("data_source_id", "name", name="uq_data_source_cls_policy_name"),
    )
    op.create_index("ix_data_source_cls_policies_data_source_id", "data_source_cls_policies", ["data_source_id"])
    op.create_index("ix_data_source_cls_policies_id", "data_source_cls_policies", ["id"])
    op.create_index("ix_data_source_cls_policies_organization_id", "data_source_cls_policies", ["organization_id"])
    op.create_index(
        "ix_data_source_cls_policies_source_enabled",
        "data_source_cls_policies",
        ["data_source_id", "enabled"],
    )

    op.create_table(
        "data_source_cls_rules",
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
            "action",
            sa.Enum("deny", "mask", name="data_source_cls_action_enum"),
            nullable=False,
        ),
        sa.Column(
            "mask_strategy",
            sa.Enum("fixed", "partial", "hash", "null", name="data_source_cls_mask_enum"),
            nullable=True,
        ),
        sa.Column(
            "mask_config",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
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
        sa.ForeignKeyConstraint(["policy_id"], ["data_source_cls_policies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_data_source_cls_rules_id", "data_source_cls_rules", ["id"])
    op.create_index("ix_data_source_cls_rules_policy_id", "data_source_cls_rules", ["policy_id"])

    op.add_column(
        "data_source_access_grants",
        sa.Column("cls_policy_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index(
        "ix_data_source_access_grants_cls_policy_id",
        "data_source_access_grants",
        ["cls_policy_id"],
    )
    op.create_foreign_key(
        "data_source_access_grants_cls_policy_id_fkey",
        "data_source_access_grants",
        "data_source_cls_policies",
        ["cls_policy_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    bind = op.get_bind()

    op.drop_constraint(
        "data_source_access_grants_cls_policy_id_fkey",
        "data_source_access_grants",
        type_="foreignkey",
    )
    op.drop_index("ix_data_source_access_grants_cls_policy_id", table_name="data_source_access_grants")
    op.drop_column("data_source_access_grants", "cls_policy_id")

    op.drop_index("ix_data_source_cls_rules_policy_id", table_name="data_source_cls_rules")
    op.drop_index("ix_data_source_cls_rules_id", table_name="data_source_cls_rules")
    op.drop_table("data_source_cls_rules")

    op.drop_index("ix_data_source_cls_policies_source_enabled", table_name="data_source_cls_policies")
    op.drop_index("ix_data_source_cls_policies_organization_id", table_name="data_source_cls_policies")
    op.drop_index("ix_data_source_cls_policies_id", table_name="data_source_cls_policies")
    op.drop_index("ix_data_source_cls_policies_data_source_id", table_name="data_source_cls_policies")
    op.drop_table("data_source_cls_policies")

    sa.Enum(name="data_source_cls_mask_enum").drop(bind, checkfirst=True)
    sa.Enum(name="data_source_cls_action_enum").drop(bind, checkfirst=True)
