"""Warehouse: compute profiles over Gold tables and their query history."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "2026_09_26_warehouse"
down_revision = "2026_09_26_notebooks"
branch_labels = None
depends_on = None


def _base():
    return [
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.current_timestamp()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true")),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false")),
    ]


def upgrade() -> None:
    op.create_table(
        "warehouses",
        *_base(),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("size", sa.String(20), nullable=False, server_default="small"),
        sa.Column("timeout_seconds", sa.Integer(), nullable=False, server_default="120"),
        sa.Column("max_concurrent", sa.Integer(), nullable=False, server_default="4"),
        sa.Column("cache_ttl_seconds", sa.Integer(), nullable=False, server_default="900"),
        sa.Column("max_scan_gb", sa.Float(), nullable=False, server_default="20"),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("data_source_id", sa.String(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index("ix_warehouses_id", "warehouses", ["id"])
    op.create_index("ix_warehouses_organization_id", "warehouses", ["organization_id"])
    op.create_index("ix_warehouses_project_id", "warehouses", ["project_id"])
    op.create_index("ix_warehouses_data_source_id", "warehouses", ["data_source_id"])
    op.create_table(
        "warehouse_queries",
        *_base(),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("warehouse_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("sql_text", sa.Text(), nullable=False),
        sa.Column("sql_hash", sa.String(64), nullable=False),
        sa.Column("tables", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("queued_ms", sa.Integer(), nullable=True),
        sa.Column("rows", sa.Integer(), nullable=True),
        sa.Column("bytes_scanned", sa.BigInteger(), nullable=True),
        sa.Column("cache_hit", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_index("ix_warehouse_queries_id", "warehouse_queries", ["id"])
    op.create_index("ix_warehouse_queries_organization_id", "warehouse_queries", ["organization_id"])
    op.create_index("ix_warehouse_queries_warehouse_id", "warehouse_queries", ["warehouse_id"])
    op.create_index("ix_warehouse_queries_user_id", "warehouse_queries", ["user_id"])
    op.create_index("ix_warehouse_queries_sql_hash", "warehouse_queries", ["sql_hash"])
    op.create_index("ix_warehouse_queries_org_created", "warehouse_queries", ["organization_id", "created_at"])


def downgrade() -> None:
    op.drop_table("warehouse_queries")
    op.drop_table("warehouses")
