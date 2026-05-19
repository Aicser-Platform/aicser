"""add_project_id_to_dashboards

Revision ID: 4aa4ed67bea3
Revises: a1b2c3d4e5f6
Create Date: 2026-05-07 06:49:45.177691

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4aa4ed67bea3'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('dashboards', sa.Column('project_id', sa.UUID(), nullable=True))
    op.create_index(op.f('ix_dashboards_project_id'), 'dashboards', ['project_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_dashboards_project_id'), table_name='dashboards')
    op.drop_column('dashboards', 'project_id')
