"""Add organization branding columns (logo_url, settings JSONB)."""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql

revision: str = "f3a4b5c6d7e8"
down_revision: Union[str, Sequence[str], None] = "e2f3a4b5c6d7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _org_columns() -> set[str]:
    bind = op.get_bind()
    return {col["name"] for col in inspect(bind).get_columns("organizations")}


def upgrade() -> None:
    cols = _org_columns()
    if "logo_url" not in cols:
        op.add_column("organizations", sa.Column("logo_url", sa.String(length=2048), nullable=True))
    if "settings" not in cols:
        op.add_column(
            "organizations",
            sa.Column(
                "settings",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=True,
                server_default=sa.text("'{}'::jsonb"),
            ),
        )


def downgrade() -> None:
    op.drop_column("organizations", "settings")
    op.drop_column("organizations", "logo_url")
