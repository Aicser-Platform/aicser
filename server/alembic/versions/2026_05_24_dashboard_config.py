"""Dashboard config defaults and pages index.

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE dashboards
        SET config = (
            COALESCE(config::jsonb, '{}'::jsonb)
            || jsonb_build_object(
                'global_filters', COALESCE(config::jsonb->'global_filters', '[]'::jsonb),
                'theme', COALESCE(config::jsonb->>'theme', 'light'),
                'pages_meta', COALESCE(config::jsonb->'pages_meta', '{}'::jsonb)
            )
        )::json
        WHERE config IS NULL
           OR (config::jsonb)->'global_filters' IS NULL
           OR (config::jsonb->>'theme') IS NULL;
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_dashboard_pages_dashboard_id
        ON dashboard_pages (dashboard_id);
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_dashboard_pages_dashboard_id")
