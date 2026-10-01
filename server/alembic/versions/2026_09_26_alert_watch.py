"""Watch a chart: an alert rule can watch a chart's number (evaluated like its KPI) and keep the
last value and per-group breakdown so a breach can say what moved it."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "2026_09_26_alert_watch"
down_revision = "2026_09_26_ai_eval_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("alert_rules", sa.Column("source", postgresql.JSONB(), nullable=True))
    op.add_column("alert_rules", sa.Column("last_value", sa.Float(), nullable=True))
    op.add_column("alert_rules", sa.Column("last_snapshot", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("alert_rules", "last_snapshot")
    op.drop_column("alert_rules", "last_value")
    op.drop_column("alert_rules", "source")
