"""merge plugin_enablements and office_file_shares

Revision ID: 2026_11_14_merge_plugin_office
Revises: 2026_10_31_plugin_enablements, 2026_11_13_office_file_shares
Create Date: 2026-11-14

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2026_11_14_merge_plugin_office'
down_revision: Union[str, None] = ('2026_10_31_plugin_enablements', '2026_11_13_office_file_shares')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
