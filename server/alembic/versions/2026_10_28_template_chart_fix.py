"""Repair charts made from sample dashboard templates, and sample sources without an organization

Four template KPIs ran without their filter or format, so the number disagreed with the SQL shown beside it
(Overdue Loans showed every loan: 120 instead of 16). Each is fixed only while it is still exactly as the
template made it; a chart someone has edited is left alone. Template charts that run their fields no longer
keep SQL that never runs. Sample sources made without an organization get their project's, so the project's
source lists include them again (their charts were flagged as using another project's data).

Revision ID: 2026_10_28_template_chart_fix
Revises: 2026_10_27_agent_tuning
Create Date: 2026-10-28
"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "2026_10_28_template_chart_fix"
down_revision: Union[str, None] = "2026_10_27_agent_tuning"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (template, chart title, query as the template made it) → query and options it should have had.
FIXES = [
    ("banking_portfolio_overview", "Overdue Loans", {"aggregate": "count", "tableName": "loans"},
     {"aggregate": "count", "tableName": "loans", "filters": [{"field": "npl_flag", "operator": "=", "value": True}]},
     None),
    ("education_enrollment_health", "Active Enrollments", {"aggregate": "count", "tableName": "enrollments"},
     {"aggregate": "count", "tableName": "enrollments",
      "filters": [{"field": "status_id", "operator": "=", "value": 1}]},
     None),
    ("gov_service_delivery_pulse", "Resolved Requests", {"aggregate": "count", "tableName": "service_requests"},
     {"aggregate": "count", "tableName": "service_requests",
      "filters": [{"field": "resolved_date", "operator": "is_not_null"}]},
     None),
    ("banking_portfolio_overview", "Avg Loan Interest Rate %",
     {"yMetrics": [{"field": "interest_rate", "aggregation": "avg"}], "tableName": "loans"},
     {"yMetrics": [{"field": "interest_rate", "aggregation": "avg", "valueFormat": "percent"}], "tableName": "loans"},
     {"format": "percent"}),
]


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if "data_sources" in tables and "projects" in tables:
        bind.execute(sa.text(
            "UPDATE data_sources d SET organization_id = p.organization_id FROM projects p "
            "WHERE d.organization_id IS NULL AND d.project_id = p.id AND p.organization_id IS NOT NULL "
            "AND d.type = 'sample_duckdb'"
        ))
    if "charts" not in tables:
        return
    for template_id, title, made, fixed, options in FIXES:
        bind.execute(sa.text(
            "UPDATE charts SET chart_query = CAST(:fixed AS JSONB), "
            "chart_options = chart_options || CAST(:options AS JSONB) "
            "WHERE chart_options->>'template_id' = :template AND title = :title "
            "AND chart_query::jsonb = CAST(:made AS JSONB)"
        ), {"fixed": json.dumps(fixed), "options": json.dumps(options or {}), "template": template_id,
            "title": title, "made": json.dumps(made)})
    # Template charts that run their fields: drop the SQL that never runs (it was shown as if it did).
    bind.execute(sa.text(
        "UPDATE charts SET chart_options = chart_options - 'sample_sql' "
        "WHERE chart_options ? 'template_id' AND chart_options ? 'sample_sql' "
        "AND chart_query ? 'tableName' AND (chart_query ? 'x' OR chart_query ? 'yMetrics' "
        "OR (chart_type IN ('stat', 'gauge', 'kpi') AND chart_query ? 'aggregate'))"
    ))


def downgrade() -> None:
    # Data repair only; the previous values were wrong, so there is nothing to restore.
    pass
