"""Semantic compiler tables: entities, measures, time spines; extend metrics/dimensions."""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b9c0d1e2f3a4"
down_revision: Union[str, None] = "a8b9c0d1e2f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "semantic_entities",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("data_source_id", sa.String(), sa.ForeignKey("data_sources.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("primary_entity", sa.String(), nullable=True),
        sa.Column("default_time_dimension", sa.String(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("source", sa.String(), server_default="manual", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_semantic_entities_data_source_id", "semantic_entities", ["data_source_id"])

    op.create_table(
        "semantic_measures",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("entity_id", sa.String(), sa.ForeignKey("semantic_entities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("data_source_id", sa.String(), sa.ForeignKey("data_sources.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("expression", sa.Text(), nullable=False),
        sa.Column("agg", sa.String(), server_default="sum", nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("source", sa.String(), server_default="manual", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_semantic_measures_entity_id", "semantic_measures", ["entity_id"])

    op.create_table(
        "semantic_time_spines",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("data_source_id", sa.String(), sa.ForeignKey("data_sources.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(), server_default="standard", nullable=False),
        sa.Column("base_column", sa.String(), nullable=False),
        sa.Column("grain", sa.String(), server_default="day", nullable=False),
        sa.Column("sql_template", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_semantic_time_spines_data_source_id", "semantic_time_spines", ["data_source_id"])

    op.add_column("semantic_metrics", sa.Column("metric_type", sa.String(), server_default="simple", nullable=False))
    op.add_column("semantic_metrics", sa.Column("type_params", postgresql.JSONB(), server_default="{}", nullable=False))
    op.add_column("semantic_metrics", sa.Column("filter", postgresql.JSONB(), nullable=True))
    op.add_column("semantic_metrics", sa.Column("time_grain", sa.String(), nullable=True))
    op.add_column("semantic_metrics", sa.Column("certified", sa.Boolean(), server_default=sa.text("false"), nullable=False))
    op.add_column("semantic_metrics", sa.Column("version", sa.Integer(), server_default="1", nullable=False))

    op.add_column("semantic_dimensions", sa.Column("certified", sa.Boolean(), server_default=sa.text("false"), nullable=False))
    op.add_column("semantic_dimensions", sa.Column("version", sa.Integer(), server_default="1", nullable=False))


def downgrade() -> None:
    op.drop_column("semantic_dimensions", "version")
    op.drop_column("semantic_dimensions", "certified")
    op.drop_column("semantic_metrics", "version")
    op.drop_column("semantic_metrics", "certified")
    op.drop_column("semantic_metrics", "time_grain")
    op.drop_column("semantic_metrics", "filter")
    op.drop_column("semantic_metrics", "type_params")
    op.drop_column("semantic_metrics", "metric_type")
    op.drop_index("ix_semantic_time_spines_data_source_id", table_name="semantic_time_spines")
    op.drop_table("semantic_time_spines")
    op.drop_index("ix_semantic_measures_entity_id", table_name="semantic_measures")
    op.drop_table("semantic_measures")
    op.drop_index("ix_semantic_entities_data_source_id", table_name="semantic_entities")
    op.drop_table("semantic_entities")
