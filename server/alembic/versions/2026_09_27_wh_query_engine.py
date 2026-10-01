"""Record which engine ran each warehouse query (auto warehouses choose per query)."""
import sqlalchemy as sa
from alembic import op

revision = "2026_09_27_wh_query_engine"
down_revision = "2026_09_26_ml_models"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("warehouse_queries", sa.Column("engine", sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column("warehouse_queries", "engine")
