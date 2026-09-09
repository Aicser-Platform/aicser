"""add options jsonb to data_pipelines

Revision ID: 2026_09_09_pipeline_options
Revises: 2026_08_28_onboarding_sheet_idx
Create Date: 2026-09-09
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "2026_09_09_pipeline_options"
down_revision: Union[str, None] = "2026_08_28_onboarding_sheet_idx"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "data_pipelines",
        sa.Column(
            "options",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("data_pipelines", "options")
