"""An embed visitor can narrow what a chart shows, never widen it (Metabase/Looker: viewers only
get the filters the author exposed)."""

from types import SimpleNamespace

from src.modules.dashboards.operations import (
    apply_drill_context,
    exposed_filter_columns,
    merge_runtime_filters,
    restrict_to_exposed,
)

CHART = {"x": "category", "filters": [{"field": "region", "operator": "eq", "value": "US"}], "drillPath": ["category", "brand"]}


def test_a_signed_in_viewers_filter_still_replaces_the_saved_one():
    merged = merge_runtime_filters(CHART, [{"field": "region", "operator": "in", "value": ["US", "EU"]}])
    assert [f["value"] for f in merged["filters"]] == [["US", "EU"]]


def test_an_embed_visitors_filter_only_narrows():
    """region IN (US, EU) from an iframe must not undo the chart's saved region = US."""
    merged = merge_runtime_filters(CHART, [{"field": "region", "operator": "in", "value": ["US", "EU"]}], narrow_only=True)
    assert {"field": "region", "operator": "eq", "value": "US"} in merged["filters"]
    assert len(merged["filters"]) == 2


def test_only_columns_the_dashboard_exposes_can_be_filtered():
    dashboard = SimpleNamespace(config={"global_filters": [{"field": "orders.order_date"}, {"field": "region", "tableName": "orders"}]})
    page = SimpleNamespace(filters=[{"field": "products.category"}])
    allowed = exposed_filter_columns(dashboard, [page])
    assert allowed == {"order_date", "region", "category"}

    kept = restrict_to_exposed(
        [{"field": "orders.region", "value": "EU"}, {"field": "salary", "value": 1}, {"field": "category", "value": "x"}],
        allowed,
    )
    assert [f["field"] for f in kept] == ["orders.region", "category"]
    assert restrict_to_exposed([{"field": "salary", "value": 1}], allowed) is None


def test_an_embed_drill_uses_the_charts_own_drill_path():
    """A drill path in the request could group by any column; the visitor gets the saved one."""
    ctx = {"drill_path": ["employee_salary"], "level": 0, "drill_filters": [{"field": "salary", "value": 1}]}

    signed_in = apply_drill_context(CHART, ctx)
    embed = apply_drill_context(CHART, ctx, narrow_only=True)

    assert signed_in["x"] == "employee_salary"
    assert embed["x"] == "category"
    assert all(f["field"] != "salary" for f in embed["filters"])  # not on the drill path: dropped

    deeper = apply_drill_context(CHART, {"level": 1, "drill_filters": [{"field": "category", "value": "Books"}]}, narrow_only=True)
    assert deeper["x"] == "brand"
    assert {"field": "region", "operator": "eq", "value": "US"} in deeper["filters"]
    assert any(f["field"] == "category" for f in deeper["filters"])
