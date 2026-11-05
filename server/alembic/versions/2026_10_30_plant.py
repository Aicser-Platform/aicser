"""Plant: sensor sources, machine tree, tags, work-order targets and work orders

Revision ID: 2026_10_30_plant
Revises: 2026_10_29_alert_incidents
Create Date: 2026-10-30
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision: str = "2026_10_30_plant"
down_revision: Union[str, None] = "2026_10_29_alert_incidents"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _base():
    return [
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.current_timestamp()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true")),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false")),
    ]


def upgrade() -> None:
    u = pg.UUID(as_uuid=True)
    org = lambda: sa.Column("organization_id", u, nullable=False, index=True)  # noqa: E731
    proj = lambda: sa.Column("project_id", u, nullable=False, index=True)  # noqa: E731
    op.create_table(
        "plant_sources", *_base(), org(), proj(),
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("protocol", sa.String(20), nullable=False),
        sa.Column("config", pg.JSONB(), nullable=False, server_default="{}"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("status", sa.String(20), nullable=False, server_default="connecting"),
        sa.Column("status_detail", sa.Text(), nullable=True),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("messages_received", sa.BigInteger(), nullable=False, server_default="0"),
    )
    op.create_table(
        "plant_assets", *_base(), org(), proj(),
        sa.Column("parent_id", u, sa.ForeignKey("plant_assets.id", ondelete="CASCADE"), nullable=True, index=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("level", sa.String(20), nullable=False, server_default="machine"),
        sa.Column("health", pg.JSONB(), nullable=True),
        sa.Column("health_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "plant_tags", *_base(), org(), proj(),
        sa.Column("source_id", u, sa.ForeignKey("plant_sources.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("asset_id", u, sa.ForeignKey("plant_assets.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("key", sa.String(512), nullable=False),
        sa.Column("name", sa.String(200), nullable=True),
        sa.Column("unit", sa.String(40), nullable=True),
        sa.Column("last_value", sa.Float(), nullable=True),
        sa.Column("last_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("source_id", "key", name="uq_plant_tag_source_key"),
    )
    op.create_table(
        "plant_work_targets", *_base(), org(),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("auth_header", sa.Text(), nullable=True),
        sa.Column("field_map", pg.JSONB(), nullable=False, server_default="{}"),
    )
    op.create_table(
        "plant_work_orders", *_base(),
        sa.Column("organization_id", u, nullable=False),
        sa.Column("project_id", u, nullable=True, index=True),
        sa.Column("asset_id", u, sa.ForeignKey("plant_assets.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("target_id", u, sa.ForeignKey("plant_work_targets.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("priority", sa.String(20), nullable=False, server_default="medium"),
        sa.Column("status", sa.String(20), nullable=False, server_default="sent"),
        sa.Column("external_id", sa.String(200), nullable=True),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("source_event_id", sa.String(64), nullable=True, index=True),
        sa.Column("created_by", sa.String(), nullable=True),
    )
    op.create_index("ix_plant_work_orders_org_created", "plant_work_orders", ["organization_id", "created_at"])


def downgrade() -> None:
    for table in ("plant_work_orders", "plant_work_targets", "plant_tags", "plant_assets", "plant_sources"):
        op.drop_table(table)
