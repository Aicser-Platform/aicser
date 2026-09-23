"""add staging layer, asset profiles and onboarding sessions

Revision ID: 2026_08_27_pipeline_onboarding
Revises: 2026_08_25_pipeline_lineage
Create Date: 2026-08-27
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "2026_08_27_pipeline_onboarding"
down_revision: Union[str, None] = "2026_08_25_pipeline_lineage"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _base_cols():
    return [
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "is_active", sa.Boolean(), server_default=sa.text("true"), nullable=True
        ),
        sa.Column(
            "is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=True
        ),
    ]


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction block.
    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TYPE data_lake_layer_enum "
            "ADD VALUE IF NOT EXISTS 'staging' BEFORE 'bronze'"
        )

    op.create_table(
        "data_asset_profiles",
        *_base_cols(),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("lake_object_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "layer",
            postgresql.ENUM(name="data_lake_layer_enum", create_type=False),
            nullable=False,
        ),
        sa.Column(
            "row_count", sa.Integer(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column(
            "sampled", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column(
            "health_score", sa.Integer(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column(
            "profile",
            postgresql.JSONB(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "findings",
            postgresql.JSONB(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["lake_object_id"], ["data_lake_objects.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_data_asset_profiles_organization_id",
        "data_asset_profiles",
        ["organization_id"],
    )
    op.create_index(
        "ix_data_asset_profiles_lake_object_id",
        "data_asset_profiles",
        ["lake_object_id"],
    )
    op.create_index(
        "ix_data_asset_profiles_object_created",
        "data_asset_profiles",
        ["lake_object_id", "created_at"],
    )

    op.create_table(
        "data_onboarding_sessions",
        *_base_cols(),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("data_source_id", sa.String(), nullable=False),
        sa.Column("staging_object_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("bronze_object_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("profile_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "profiling",
                "review",
                "ingesting",
                "ingested",
                "failed",
                "abandoned",
                name="data_onboarding_status_enum",
            ),
            server_default=sa.text("'profiling'"),
            nullable=False,
        ),
        sa.Column(
            "decisions",
            postgresql.JSONB(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["data_source_id"], ["data_sources.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["staging_object_id"], ["data_lake_objects.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["bronze_object_id"], ["data_lake_objects.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["profile_id"], ["data_asset_profiles.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_data_onboarding_sessions_organization_id",
        "data_onboarding_sessions",
        ["organization_id"],
    )
    op.create_index(
        "ix_data_onboarding_sessions_data_source_id",
        "data_onboarding_sessions",
        ["data_source_id"],
    )
    op.create_index(
        "ix_data_onboarding_sessions_status",
        "data_onboarding_sessions",
        ["status"],
    )
    op.create_index(
        "uq_data_onboarding_open_per_source",
        "data_onboarding_sessions",
        ["data_source_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('profiling', 'review', 'ingesting')"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_data_onboarding_open_per_source", table_name="data_onboarding_sessions"
    )
    op.drop_table("data_onboarding_sessions")
    op.drop_table("data_asset_profiles")
    op.execute("DROP TYPE IF EXISTS data_onboarding_status_enum")
    # 'staging' cannot be removed from data_lake_layer_enum; PostgreSQL has no
    # ALTER TYPE ... DROP VALUE. Rows using it must be migrated by hand first.
