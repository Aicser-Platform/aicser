"""Semantic domains record their organization

Domains created while the sign-in token carried no organization were saved without one, which
made them visible to anyone else in the same situation. Each takes its creator's organization.

Revision ID: 2026_10_17_domain_org
Revises: 2026_10_17_kpi_to_semantic
Create Date: 2026-10-17
"""

from typing import Sequence, Union

from alembic import op

revision: str = "2026_10_17_domain_org"
down_revision: Union[str, None] = "2026_10_17_kpi_to_semantic"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
          IF to_regclass('public.user_roles') IS NULL THEN
            RETURN;
          END IF;
          WITH target AS (
            SELECT DISTINCT ON (d.id) d.id, d.name, r.organization_id AS org
            FROM semantic_domains d
            JOIN user_roles r ON r.user_id = d.created_by AND r.organization_id IS NOT NULL
                             AND r.is_active IS TRUE AND r.is_deleted IS NOT TRUE
            WHERE d.organization_id IS NULL
            ORDER BY d.id, r.project_id NULLS FIRST, r.created_at
          ), ranked AS (
            -- Two people's domains with the same name can't both join one organization.
            SELECT t.*, ROW_NUMBER() OVER (PARTITION BY t.org, t.name ORDER BY t.id) AS n FROM target t
          )
          UPDATE semantic_domains d SET organization_id = ranked.org
          FROM ranked
          WHERE d.id = ranked.id AND ranked.n = 1
            AND NOT EXISTS (SELECT 1 FROM semantic_domains o WHERE o.organization_id = ranked.org AND o.name = ranked.name);
        END $$;
        """
    )


def downgrade() -> None:
    pass
