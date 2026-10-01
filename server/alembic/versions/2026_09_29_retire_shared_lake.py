"""retire Silver/Gold lake objects stored at a location shared by several tables

Before per-table Iceberg identifiers, LoadStage wrote every table of a source
to one catalog table / one location, so a scan of any of them returned a mix
of tables (e.g. `orders` returned customers' rows). Those objects can't be
repaired, and while active they are served in preference to correct data.
Mark them `superseded`; the next pipeline run writes clean per-table objects.
Locations used by a single table are left untouched.

Downgrade is a no-op: the retired objects are corrupt and must not be served.

Revision ID: 2026_09_29_retire_shared_lake
Revises: 2026_09_29_gold_lakehouse_owner
Create Date: 2026-09-29
"""

from typing import Sequence, Union

from alembic import op

revision: str = "2026_09_29_retire_shared_lake"
down_revision: Union[str, None] = "2026_09_29_gold_lakehouse_owner"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE data_lake_objects AS o
        SET status = 'superseded'
        WHERE o.status = 'active'
          AND o.layer IN ('silver', 'gold')
          AND o.format = 'iceberg'
          AND o.storage_uri IN (
              SELECT storage_uri
              FROM data_lake_objects
              WHERE status = 'active'
                AND layer IN ('silver', 'gold')
                AND format = 'iceberg'
                AND storage_uri IS NOT NULL
              GROUP BY storage_uri
              HAVING COUNT(DISTINCT source_table) > 1
          )
        """
    )


def downgrade() -> None:
    pass
