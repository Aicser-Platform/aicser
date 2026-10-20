"""Pipelines named after an internal id get their source's name

Early onboarding named pipelines "<data source id> pipeline". New ones are named after the source;
this renames the old ones the same way, in the pipeline and in its saved wizard settings, so every
list, warning and notification shows a name people recognise. Slugs stay (a rename keeps its slug).
Downgrade is a no-op.

Revision ID: 2026_10_17_pipeline_names
Revises: 2026_10_16_semantic_domains
Create Date: 2026-10-17
"""

from typing import Sequence, Union

from alembic import op

revision: str = "2026_10_17_pipeline_names"
down_revision: Union[str, None] = "2026_10_16_semantic_domains"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

GENERATED = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}( pipeline)?$"


def upgrade() -> None:
    op.execute(
        f"""
        UPDATE data_pipelines p
        SET name = LEFT(s.name, 191) || ' pipeline',
            options = CASE
                WHEN p.options ? 'wizard_state'
                THEN jsonb_set(p.options, '{{wizard_state,pipelineName}}', to_jsonb(LEFT(s.name, 191) || ' pipeline'))
                ELSE p.options
            END
        FROM data_sources s
        WHERE s.id = p.source_asset_id
          AND p.name ~* '{GENERATED}'
          AND COALESCE(TRIM(s.name), '') <> ''
          AND NOT EXISTS (
              SELECT 1 FROM data_pipelines q
              WHERE q.organization_id = p.organization_id AND q.id <> p.id
                AND q.name = LEFT(s.name, 191) || ' pipeline'
          )
        """
    )


def downgrade() -> None:
    pass
