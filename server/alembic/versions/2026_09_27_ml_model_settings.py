"""Model settings (forecast models keep their recipe: query, columns, grain, horizon)."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "2026_09_27_ml_model_settings"
down_revision = "2026_09_27_wh_query_engine"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ml_models", sa.Column("settings", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("ml_models", "settings")
