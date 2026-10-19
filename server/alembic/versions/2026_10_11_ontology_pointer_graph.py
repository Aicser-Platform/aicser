"""Pointer-only ontology graph + certified metric SLO columns.

Relational ontology_nodes / ontology_edges are the source of truth.
Apache AGE is optional (CREATE EXTENSION IF NOT EXISTS) and never required.
Metric SQL and document bytes stay in their existing tables.

Revision ID: 2026_10_11_ontology_graph
Revises: 2026_10_05_sub_period_starts_at
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "2026_10_11_ontology_graph"
down_revision: Union[str, None] = "2026_10_05_sub_period_starts_at"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ontology_nodes",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("tenant_id", sa.String(length=64), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("ptr", sa.Text(), nullable=False),
        sa.Column("ptr_type", sa.String(length=32), nullable=False),
        sa.Column("props", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "kind", "ptr_type", "ptr", name="uq_ontology_node_ptr"),
    )
    op.create_index("ix_ontology_nodes_tenant_id", "ontology_nodes", ["tenant_id"])
    op.create_index("ix_ontology_nodes_project_id", "ontology_nodes", ["project_id"])
    op.create_index("ix_ontology_nodes_kind", "ontology_nodes", ["kind"])
    op.create_index("ix_ontology_nodes_tenant_kind", "ontology_nodes", ["tenant_id", "kind"])
    op.create_index("ix_ontology_nodes_ptr", "ontology_nodes", ["ptr_type", "ptr"])

    op.create_table(
        "ontology_edges",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("tenant_id", sa.String(length=64), nullable=False),
        sa.Column("edge_type", sa.String(length=32), nullable=False),
        sa.Column("src_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("dst_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("props", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["src_id"], ["ontology_nodes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["dst_id"], ["ontology_nodes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "edge_type", "src_id", "dst_id", name="uq_ontology_edge"),
    )
    op.create_index("ix_ontology_edges_tenant_id", "ontology_edges", ["tenant_id"])
    op.create_index("ix_ontology_edges_edge_type", "ontology_edges", ["edge_type"])
    op.create_index("ix_ontology_edges_src", "ontology_edges", ["src_id"])
    op.create_index("ix_ontology_edges_dst", "ontology_edges", ["dst_id"])

    op.add_column("semantic_metrics", sa.Column("certified_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("semantic_metrics", sa.Column("freshness_slo_hours", sa.Integer(), nullable=True))

    op.execute(
        """
        DO $$
        BEGIN
            CREATE EXTENSION IF NOT EXISTS age;
        EXCEPTION
            WHEN undefined_file OR feature_not_supported OR insufficient_privilege THEN
                RAISE NOTICE 'Apache AGE extension not installed; ontology uses relational tables';
        END
        $$;
        """
    )


def downgrade() -> None:
    op.drop_column("semantic_metrics", "freshness_slo_hours")
    op.drop_column("semantic_metrics", "certified_at")
    op.drop_index("ix_ontology_edges_dst", table_name="ontology_edges")
    op.drop_index("ix_ontology_edges_src", table_name="ontology_edges")
    op.drop_index("ix_ontology_edges_edge_type", table_name="ontology_edges")
    op.drop_index("ix_ontology_edges_tenant_id", table_name="ontology_edges")
    op.drop_table("ontology_edges")
    op.drop_index("ix_ontology_nodes_ptr", table_name="ontology_nodes")
    op.drop_index("ix_ontology_nodes_tenant_kind", table_name="ontology_nodes")
    op.drop_index("ix_ontology_nodes_kind", table_name="ontology_nodes")
    op.drop_index("ix_ontology_nodes_project_id", table_name="ontology_nodes")
    op.drop_index("ix_ontology_nodes_tenant_id", table_name="ontology_nodes")
    op.drop_table("ontology_nodes")
