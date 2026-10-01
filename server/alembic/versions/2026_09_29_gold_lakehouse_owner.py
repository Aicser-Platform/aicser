"""backfill owner/project on pipeline-generated Gold Lakehouse data sources

LoadStage created "<pipeline> (Gold Lakehouse)" sources with no user_id and no
project_id, so the data-source permission check (creator or project member)
denied everyone and the source's page reported it as missing. Give each such
source the owner and project of the source its pipeline reads from. Rows that
already have an owner are left alone; downgrade is a no-op (the NULLs were a bug).

Revision ID: 2026_09_29_gold_lakehouse_owner
Revises: 2026_09_10_pipeline_sheets
Create Date: 2026-09-29
"""

from typing import Sequence, Union

from alembic import op

revision: str = "2026_09_29_gold_lakehouse_owner"
down_revision: Union[str, None] = "2026_09_10_pipeline_sheets"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE data_sources AS gold
        SET user_id = COALESCE(gold.user_id, src.user_id, p.created_by),
            project_id = COALESCE(gold.project_id, src.project_id)
        FROM data_pipelines AS p
        LEFT JOIN data_sources AS src
          ON p.source_asset_type = 'data_source' AND src.id = p.source_asset_id
        WHERE gold.type = 'lakehouse_iceberg'
          AND gold.organization_id = p.organization_id
          AND gold.name = p.name || ' (Gold Lakehouse)'
          AND (gold.user_id IS NULL OR gold.project_id IS NULL)
        """
    )


def downgrade() -> None:
    pass
