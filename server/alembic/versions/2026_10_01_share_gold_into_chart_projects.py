"""share pipeline Gold Lakehouse sources into the projects whose charts already use them

Gold Lakehouse sources were created without a project, so charts in any project of the org
could use them. 2026_09_29_gold_lakehouse_owner then gave each source its pipeline's project,
and the project rule (a chart may only read its own project's sources) now refuses those
charts with "This chart uses a data source from another project". Share the source into each
such chart's project (project_data_source), the same link a person makes by adding a source
to a project. Only projects of the source's own organization are linked; downgrade is a no-op
(removing the links would break the charts again).

Revision ID: 2026_10_01_share_gold_charts
Revises: 2026_10_01_merge_pipeline_main
Create Date: 2026-10-01
"""

from typing import Sequence, Union

from alembic import op

revision: str = "2026_10_01_share_gold_charts"
down_revision: Union[str, None] = "2026_10_01_merge_pipeline_main"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO project_data_source (project_id, data_source_id, data_source_type, is_active)
        SELECT DISTINCT c.project_id, gold.id, gold.type, TRUE
        FROM charts AS c
        JOIN data_sources AS gold ON gold.id = c.data_source_id
        JOIN projects AS chart_project ON chart_project.id = c.project_id
        WHERE gold.type = 'lakehouse_iceberg'
          AND gold.project_id IS NOT NULL
          AND c.project_id <> gold.project_id
          AND chart_project.organization_id = gold.organization_id
          AND NOT EXISTS (
              SELECT 1 FROM project_data_source AS link
              WHERE link.project_id = c.project_id
                AND link.data_source_id = gold.id
                AND link.is_active
          )
        """
    )


def downgrade() -> None:
    pass
