"""data_lake_objects.storage_destination_id: the saved S3 connection a Silver/Gold object
was written to (NULL = the platform lakehouse)

Revision ID: 2026_10_02_lake_storage_dest
Revises: 2026_10_02_trial_clear_ends_at
Create Date: 2026-10-02
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "2026_10_02_lake_storage_dest"
down_revision: Union[str, None] = "2026_10_02_trial_clear_ends_at"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("data_lake_objects", sa.Column("storage_destination_id", sa.String(), nullable=True))
    op.create_index(
        "ix_data_lake_objects_storage_destination_id", "data_lake_objects", ["storage_destination_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_data_lake_objects_storage_destination_id", table_name="data_lake_objects")
    op.drop_column("data_lake_objects", "storage_destination_id")
