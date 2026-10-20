"""Prepare recipes record their organization

Recipes created while the sign-in token carried no organization were saved without one, so
organization-wide checks (contracts, impact) could not find them. Take it from the project.

Revision ID: 2026_10_17_recipe_org
Revises: 2026_10_17_data_contracts
Create Date: 2026-10-17
"""

from typing import Sequence, Union

from alembic import op

revision: str = "2026_10_17_recipe_org"
down_revision: Union[str, None] = "2026_10_17_data_contracts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE prep_recipes r SET organization_id = p.organization_id
        FROM projects p
        WHERE r.organization_id IS NULL AND p.id = r.project_id AND p.organization_id IS NOT NULL
        """
    )


def downgrade() -> None:
    pass
