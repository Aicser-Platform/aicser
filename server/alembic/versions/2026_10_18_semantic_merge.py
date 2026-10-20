"""Semantic model consolidation: time is a dimension, Core calendar, column meaning from Prepare

- semantic_dimensions gains dimension_type ('category' | 'time') and default_grain. Dimensions
  that read as dates become time dimensions; every time spine becomes (or marks) a time
  dimension, then semantic_time_spines is dropped.
- semantic_domains gains calendar (fiscal year start, week start), used through the Core domain.
- prep_recipes gains column_meta: what each output column means, set in Prepare.
- semantic_entities and semantic_measures are dropped: nothing reads or writes them.

Revision ID: 2026_10_18_semantic_merge
Revises: 2026_10_18_metric_drafts
Create Date: 2026-10-18
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "2026_10_18_semantic_merge"
down_revision: Union[str, None] = "2026_10_18_metric_drafts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TIME_NAME = r"(_date|_at|_time|_timestamp|_day|_month)$|^(date|day|month|created|updated|timestamp)$"


def upgrade() -> None:
    op.add_column(
        "semantic_dimensions",
        sa.Column("dimension_type", sa.String(20), nullable=False, server_default="category"),
    )
    op.add_column("semantic_dimensions", sa.Column("default_grain", sa.String(20), nullable=True))
    op.execute(
        f"""
        UPDATE semantic_dimensions SET dimension_type = 'time', default_grain = COALESCE(default_grain, 'day')
        WHERE lower(name) ~ '{TIME_NAME}'
        """
    )

    # Each active time spine: mark the dimension on its column as time, or create one.
    op.execute(
        """
        UPDATE semantic_dimensions d SET dimension_type = 'time', default_grain = s.grain
        FROM semantic_time_spines s
        WHERE s.is_active AND d.is_active AND d.data_source_id = s.data_source_id
          AND (lower(d.expression) = lower(s.base_column) OR lower(d.name) = lower(s.base_column))
        """
    )
    op.execute(
        """
        INSERT INTO semantic_dimensions (id, data_source_id, name, expression, description, source,
                                         dimension_type, default_grain)
        SELECT md5('spine:' || s.id)::uuid::text, s.data_source_id,
               regexp_replace(lower(s.base_column), '[^a-z0-9]+', '_', 'g'), s.base_column,
               'Time dimension (from the earlier time settings)', 'migration', 'time', s.grain
        FROM semantic_time_spines s
        WHERE s.is_active AND NOT EXISTS (
            SELECT 1 FROM semantic_dimensions d
            WHERE d.is_active AND d.data_source_id = s.data_source_id
              AND (lower(d.expression) = lower(s.base_column) OR lower(d.name) = lower(s.base_column)
                   OR lower(d.name) = regexp_replace(lower(s.base_column), '[^a-z0-9]+', '_', 'g'))
        )
        """
    )
    op.drop_table("semantic_time_spines")

    op.add_column(
        "semantic_domains",
        sa.Column("calendar", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.add_column(
        "prep_recipes",
        sa.Column("column_meta", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )

    op.drop_table("semantic_measures")
    op.drop_table("semantic_entities")


def downgrade() -> None:
    op.create_table(
        "semantic_entities",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("data_source_id", sa.String(), sa.ForeignKey("data_sources.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("primary_entity", sa.String(), nullable=True),
        sa.Column("default_time_dimension", sa.String(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("source", sa.String(), nullable=False, server_default="manual"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "semantic_measures",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("entity_id", sa.String(), sa.ForeignKey("semantic_entities.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("data_source_id", sa.String(), sa.ForeignKey("data_sources.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("expression", sa.Text(), nullable=False),
        sa.Column("agg", sa.String(), nullable=False, server_default="sum"),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("source", sa.String(), nullable=False, server_default="manual"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.drop_column("prep_recipes", "column_meta")
    op.drop_column("semantic_domains", "calendar")
    op.create_table(
        "semantic_time_spines",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("data_source_id", sa.String(), sa.ForeignKey("data_sources.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(), nullable=False, server_default="standard"),
        sa.Column("base_column", sa.String(), nullable=False),
        sa.Column("grain", sa.String(), nullable=False, server_default="day"),
        sa.Column("sql_template", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.execute(
        """
        INSERT INTO semantic_time_spines (id, data_source_id, base_column, grain)
        SELECT md5('dim:' || id)::uuid::text, data_source_id, expression, COALESCE(default_grain, 'day')
        FROM semantic_dimensions WHERE dimension_type = 'time' AND is_active AND data_source_id IS NOT NULL
        """
    )
    op.drop_column("semantic_dimensions", "default_grain")
    op.drop_column("semantic_dimensions", "dimension_type")
