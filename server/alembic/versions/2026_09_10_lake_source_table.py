"""add source_table to data_lake_objects

Revision ID: 2026_09_10_lake_source_table
Revises: 2026_09_09_pipeline_options
Create Date: 2026-09-10
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "2026_09_10_lake_source_table"
down_revision: Union[str, None] = "2026_09_09_pipeline_options"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "data_lake_objects",
        sa.Column("source_table", sa.String(), nullable=True),
    )
    op.create_index(
        "ix_data_lake_objects_source_table",
        "data_lake_objects",
        ["data_source_id", "source_table"],
    )


def downgrade() -> None:
    op.drop_index("ix_data_lake_objects_source_table", table_name="data_lake_objects")
    op.drop_column("data_lake_objects", "source_table")
