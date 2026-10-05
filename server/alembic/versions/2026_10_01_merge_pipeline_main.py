"""merge pipeline-v2 and main heads

Revision ID: 2026_10_01_merge_pipeline_main
Revises: 2026_09_29_asset_folders, 2026_09_29_retire_shared_lake
Create Date: 2026-10-01

"""
from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = '2026_10_01_merge_pipeline_main'
down_revision: Union[str, None] = ('2026_09_29_asset_folders', '2026_09_29_retire_shared_lake')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
