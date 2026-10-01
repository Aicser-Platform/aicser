"""Warehouse engine: embedded, dedicated compute pool, or distributed (Trino)."""
import sqlalchemy as sa
from alembic import op

revision = "2026_09_26_warehouse_engine"
down_revision = "2026_09_26_warehouse"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("warehouses", sa.Column("engine", sa.String(20), nullable=False, server_default="embedded"))


def downgrade() -> None:
    op.drop_column("warehouses", "engine")
