"""Bronze: one active snapshot per source table

Every scheduled run landed a full new Bronze copy and none was ever retired, so a file source
on a 15-minute schedule listed hundreds of identical "tables" in the Catalog. IngestStage now
reuses an unchanged upload's Bronze and supersedes older snapshots; this retires the copies
already registered. Only full snapshots (file uploads, and database sources loaded by snapshot
pipelines only) — incremental Bronze objects are deltas and stay. Files are not deleted.
Downgrade is a no-op.

Revision ID: 2026_10_03_bronze_one_snapshot
Revises: 2026_10_02_lake_storage_dest
Create Date: 2026-10-03
"""

from typing import Sequence, Union

from alembic import op

revision: str = "2026_10_03_bronze_one_snapshot"
down_revision: Union[str, None] = "2026_10_02_lake_storage_dest"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE data_lake_objects d
        SET status = 'superseded'
        FROM (
            SELECT o.id, ROW_NUMBER() OVER (
                PARTITION BY o.data_source_id, o.source_table
                ORDER BY o.created_at DESC NULLS LAST, o.id
            ) AS rn
            FROM data_lake_objects o
            JOIN data_sources s ON s.id = o.data_source_id
            WHERE o.layer = 'bronze'
              AND o.status = 'active'
              AND o.source_table IS NOT NULL
              AND (
                s.type = 'file'
                OR NOT EXISTS (
                    SELECT 1 FROM data_pipelines p
                    WHERE p.source_asset_id = o.data_source_id AND p.ingest_mode <> 'snapshot'
                )
              )
        ) r
        WHERE d.id = r.id AND r.rn > 1
        """
    )


def downgrade() -> None:
    pass
