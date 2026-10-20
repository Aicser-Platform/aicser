"""Notebook enterprise: settings (parameters, compute, git, certification) and run params."""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "2026_10_14_notebook_enterprise"
down_revision: Union[str, None] = "2026_10_12_log_cdc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    op.add_column(
        "notebooks",
        sa.Column("settings", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.add_column(
        "notebook_schedules",
        sa.Column("run_parameters", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.add_column(
        "notebook_runs",
        sa.Column("run_parameters", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.add_column("notebook_runs", sa.Column("actor_user_id", uuid, nullable=True))
    op.create_table(
        "notebook_audit_events",
        sa.Column("id", uuid, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("notebook_id", uuid, sa.ForeignKey("notebooks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", uuid, nullable=True),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("metadata", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_notebook_audit_nb", "notebook_audit_events", ["notebook_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_notebook_audit_nb", table_name="notebook_audit_events")
    op.drop_table("notebook_audit_events")
    op.drop_column("notebook_runs", "actor_user_id")
    op.drop_column("notebook_runs", "run_parameters")
    op.drop_column("notebook_schedules", "run_parameters")
    op.drop_column("notebooks", "settings")
