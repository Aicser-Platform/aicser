"""reconcile heads

Revision ID: 4b1c78653f5d
Revises: 2026_07_24_org_project_icon, 2026_08_25_dash_tpl_org_scope
Create Date: 2026-08-26 17:42:31.452292

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4b1c78653f5d'
down_revision: Union[str, None] = ('2026_07_24_org_project_icon', '2026_08_25_dash_tpl_org_scope')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass