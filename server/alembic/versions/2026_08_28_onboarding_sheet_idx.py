"""scope the one-open-session-per-source index by sheet

A multi-sheet workbook fans out into one onboarding session per sheet (see
select_sheets), all sharing the same data_source_id and open at once. The
original index only covered data_source_id, so the second sibling session
violated it. COALESCE the sheet_name to '' rather than dropping it from the
index -- Postgres treats NULL as distinct from NULL in a unique index, so
omitting it would silently stop enforcing "one open session" for every plain
(non-Excel) upload, none of which ever set sheet_name.

Revision ID: 2026_08_28_onboarding_sheet_idx
Revises: 2026_08_27_pipeline_onboarding
Create Date: 2026-08-28
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "2026_08_28_onboarding_sheet_idx"
down_revision: Union[str, None] = "2026_08_27_pipeline_onboarding"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


INDEX_NAME = "uq_data_onboarding_open_per_source"
TABLE = "data_onboarding_sessions"


def upgrade() -> None:
    op.drop_index(INDEX_NAME, table_name=TABLE)
    op.execute(
        f"""
        CREATE UNIQUE INDEX {INDEX_NAME}
        ON {TABLE} (data_source_id, (COALESCE(decisions->>'sheet_name', '')))
        WHERE status IN ('profiling', 'review', 'ingesting')
        """
    )


def downgrade() -> None:
    op.execute(f"DROP INDEX IF EXISTS {INDEX_NAME}")
    op.create_index(
        INDEX_NAME,
        TABLE,
        ["data_source_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('profiling', 'review', 'ingesting')"),
    )
