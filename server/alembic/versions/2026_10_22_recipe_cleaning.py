"""prep_recipes gains cleaning: the CLEAN panel's review decisions and notes.

``cleaning`` = {"decisions": {issue key: {"action", "reason"}}, "note": text}: what someone
decided about issues no step can fix, and what they want written down about the dataset.

Revision ID: 2026_10_22_recipe_cleaning
Revises: 2026_10_19_catalog_structure
Create Date: 2026-10-22
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "2026_10_22_recipe_cleaning"
down_revision: Union[str, None] = "2026_10_19_catalog_structure"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "prep_recipes",
        sa.Column("cleaning", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )


def downgrade() -> None:
    op.drop_column("prep_recipes", "cleaning")
