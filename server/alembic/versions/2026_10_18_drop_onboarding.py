"""Retire upload onboarding sessions

The upload wizard is gone: an upload is a connection people use at once, cleaned in Prepare and
landed by a pipeline. Its original file is still kept as a staging lake object; only the wizard's
session state is dropped.

Revision ID: 2026_10_18_drop_onboarding
Revises: 2026_10_18_semantic_merge
Create Date: 2026-10-18
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "2026_10_18_drop_onboarding"
down_revision: Union[str, None] = "2026_10_18_semantic_merge"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table("data_onboarding_sessions")
    op.execute("DROP TYPE IF EXISTS data_onboarding_status_enum")


def downgrade() -> None:
    status = postgresql.ENUM("profiling", "review", "ingesting", "ingested", "failed", "abandoned",
                             name="data_onboarding_status_enum")
    status.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "data_onboarding_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true()),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.false()),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True, index=True),
        sa.Column("data_source_id", sa.String(), sa.ForeignKey("data_sources.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("staging_object_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("data_lake_objects.id", ondelete="SET NULL"), nullable=True),
        sa.Column("bronze_object_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("data_lake_objects.id", ondelete="SET NULL"), nullable=True),
        sa.Column("profile_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("data_asset_profiles.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", postgresql.ENUM(name="data_onboarding_status_enum", create_type=False),
                  server_default=sa.text("'profiling'"), nullable=False),
        sa.Column("decisions", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
    )
