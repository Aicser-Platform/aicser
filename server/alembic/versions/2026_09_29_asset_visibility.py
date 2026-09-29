"""Models and AI decisions belong to a project unless shared with the whole organization.

Adds ``visibility`` ('project' | 'organization'). Rows saved without a project were visible in
every project before; they become 'organization' so nobody loses sight of them.
"""
import sqlalchemy as sa
from alembic import op

revision = "2026_09_29_asset_visibility"
down_revision = "2026_09_29_notebook_runs"
branch_labels = None
depends_on = None

TABLES = ("ml_models", "ai_decision_definitions")


def _existing() -> list:
    names = set(sa.inspect(op.get_bind()).get_table_names())
    return [t for t in TABLES if t in names]  # Enterprise tables; absent on Community installs


def upgrade() -> None:
    for table in _existing():
        cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}
        if "visibility" not in cols:
            op.add_column(table, sa.Column("visibility", sa.String(20), nullable=False, server_default="project"))
        op.execute(sa.text(f"UPDATE {table} SET visibility = 'organization' WHERE project_id IS NULL"))


def downgrade() -> None:
    for table in _existing():
        op.drop_column(table, "visibility")
