"""Add BaseModel soft-delete columns to decision_cases / decision_evidence_items.

Both models inherit deleted_at / is_active / is_deleted from src.db.base.BaseModel, but the
2026_05_30 migration created the tables without them — every ORM read of a case
(e.g. GET /api/decision-os/review-queue) failed with
"column decision_cases.deleted_at does not exist". IF NOT EXISTS keeps this safe on
databases where the columns were added by hand.
"""
from alembic import op

revision = "2026_09_23_decision_os_base_cols"
down_revision = "2026_09_14_trial_used_at"
branch_labels = None
depends_on = None

_TABLES = ("decision_cases", "decision_evidence_items")


def upgrade() -> None:
    for table in _TABLES:
        op.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE")
        op.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true")
        op.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false")


def downgrade() -> None:
    for table in _TABLES:
        op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS is_deleted")
        op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS is_active")
        op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS deleted_at")
