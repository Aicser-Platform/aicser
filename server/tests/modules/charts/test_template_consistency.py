"""Sample dashboard templates: the structured query a widget runs must mean what its SQL says.

A structured query wins over the SQL (so dashboard filters apply). Templates once kept the filter only in
the SQL, so "Overdue Loans" counted every loan (120 instead of 16) next to SQL that said otherwise.
"""

import re

from src.modules.charts.router import SAMPLE_DASHBOARD_TEMPLATES
from src.modules.charts.services.v2.chart_service import has_structured_mapping


def _widgets():
    for template in SAMPLE_DASHBOARD_TEMPLATES.values():
        for widget in template["widgets"]:
            query = {**(widget.get("chart_query") or {}), "tableName": widget.get("table", template["primary_table"])}
            yield template["id"], widget, query


def test_a_filter_in_the_sql_is_also_in_the_structured_query():
    for template_id, widget, query in _widgets():
        if not has_structured_mapping(widget["chart_type"], query):
            continue
        if re.search(r"\bWHERE\b", widget["sample_sql"], re.IGNORECASE):
            assert query.get("filters"), f"{template_id} / {widget['name']}: the SQL filters, the query does not"


def test_a_rate_shown_as_a_percentage_is_formatted_not_multiplied():
    for template_id, widget, _query in _widgets():
        if re.search(r"\*\s*100", widget["sample_sql"]):
            assert (widget.get("chart_options") or {}).get("format") == "percent", f"{template_id} / {widget['name']}"
