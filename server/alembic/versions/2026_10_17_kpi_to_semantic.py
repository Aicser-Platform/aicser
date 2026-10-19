"""KPI definitions become semantic metrics

Settings › Metric definitions (organization_kpi_definitions) and Semantic models defined the same
thing twice. Each KPI becomes a semantic metric on every connection it applies to: the ones it was
scoped to, or for organization-wide KPIs, the organization's connections that have its tables.
Verified KPIs arrive certified; trigger keywords become the metric's synonyms. A metric already
named the same on that connection wins. The KPI table is kept, read by nothing.

Revision ID: 2026_10_17_kpi_to_semantic
Revises: 2026_10_17_recipe_org
Create Date: 2026-10-17
"""

from typing import Sequence, Union

from alembic import op

revision: str = "2026_10_17_kpi_to_semantic"
down_revision: Union[str, None] = "2026_10_17_recipe_org"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
          IF to_regclass('public.organization_kpi_definitions') IS NULL THEN
            RETURN;
          END IF;

          INSERT INTO semantic_metrics (
            id, name, expression, description, category, source, certified, certified_at,
            project_id, data_source_id, type_params, metric_type, version, is_active, tags,
            created_at, updated_at
          )
          SELECT
            md5('kpi:' || k.id::text || ':' || ds.id)::uuid::text AS id,
            k.kpi_slug,
            k.sql_expression,
            COALESCE(NULLIF(TRIM(k.description), ''), k.kpi_name),
            'kpi',
            'kpi_definition',
            k.verified,
            CASE WHEN k.verified THEN now() END,
            COALESCE(
              ds.project_id,
              (SELECT p.id FROM projects p WHERE p.organization_id = k.organization_id AND p.is_deleted IS NOT TRUE
               ORDER BY p.is_default DESC NULLS LAST, p.created_at LIMIT 1)
            ),
            ds.id,
            jsonb_build_object(
              'title', k.kpi_name,
              'synonyms', COALESCE((
                SELECT jsonb_agg(DISTINCT TRIM(w)) FROM unnest(string_to_array(k.trigger_keywords, ',')) AS w
                WHERE TRIM(w) <> ''
              ), '[]'::jsonb)
            ),
            'simple', 1, true, '[]', now(), now()
          FROM organization_kpi_definitions k
          JOIN data_sources ds
            ON ds.organization_id = k.organization_id AND ds.is_active IS NOT FALSE
          WHERE (
              k.data_source_ids ? ds.id
              OR (
                jsonb_array_length(COALESCE(k.data_source_ids, '[]'::jsonb)) = 0
                AND NOT EXISTS (
                  SELECT 1 FROM jsonb_array_elements_text(COALESCE(k.required_tables, '[]'::jsonb)) t
                  WHERE position(lower(t) IN lower(COALESCE(CAST(ds.schema AS text), ''))) = 0
                )
              )
            )
            AND NOT EXISTS (
              SELECT 1 FROM semantic_metrics m
              WHERE m.data_source_id = ds.id AND m.name = k.kpi_slug AND m.is_active IS NOT FALSE
            )
          ON CONFLICT (id) DO NOTHING;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM semantic_metrics WHERE source = 'kpi_definition'")
