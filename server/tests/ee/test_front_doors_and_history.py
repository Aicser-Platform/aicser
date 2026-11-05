"""Report migration reading, dbt export, asset revisions, idle model unloading, action tools."""

import io
import json
import zipfile

import pytest

from ee.modules.bi_sync.migrate import PackageError, goal_for, read_package

TWB = b"""<?xml version='1.0'?>
<workbook>
  <datasources><datasource name='sales' caption='Sales'><connection class='postgres'/>
    <column name='[Profit Ratio]' caption='Profit Ratio'><calculation formula='SUM([Profit])/SUM([Sales])'/></column>
  </datasource></datasources>
  <worksheets><worksheet name='By region'><table><view><datasource-dependencies datasource='sales'>
    <column name='[Region]'/><column name='[Sales]'/></datasource-dependencies></view>
    <panes><pane><mark class='Bar'/></pane></panes></table></worksheet></worksheets>
  <dashboards><dashboard name='Overview'><zones><zone name='By region'/></zones></dashboard></dashboards>
</workbook>"""


def _pbit() -> bytes:
    layout = {"sections": [{"displayName": "Summary", "visualContainers": [
        {"config": json.dumps({"singleVisual": {"visualType": "clusteredColumnChart",
                                                "projections": {"Y": [{"queryRef": "Sales.Revenue"}]}}})},
        {"config": json.dumps({"singleVisual": {"visualType": "textbox"}})},
    ]}]}
    schema = {"model": {"tables": [
        {"name": "Sales", "columns": [{"name": "Revenue"}], "measures": [{"name": "Total", "expression": ["SUM(", "Sales[Revenue])"]}]},
        {"name": "LocalDateTable_1", "columns": [{"name": "Date"}]},
    ]}}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("Report/Layout", json.dumps(layout).encode("utf-16-le"))
        zf.writestr("DataModelSchema", json.dumps(schema).encode("utf-16-le"))
    return buf.getvalue()


def test_tableau_workbook_inventory():
    inv = read_package("sales.twb", TWB)
    assert inv["tool"] == "Tableau" and inv["pages"] == ["Overview"]
    assert inv["visuals"][0] == {"page": "Overview", "title": "By region", "type": "Bar", "fields": ["Region", "Sales"]}
    assert inv["measures"][0]["name"] == "Profit Ratio"


def test_twbx_reads_the_workbook_inside():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("Data/x.hyper", b"binary")
        zf.writestr("sales.twb", TWB)
    assert read_package("sales.twbx", buf.getvalue())["pages"] == ["Overview"]


def test_power_bi_template_inventory_skips_decoration_and_date_tables():
    inv = read_package("report.pbit", _pbit())
    assert inv["pages"] == ["Summary"]
    assert [v["type"] for v in inv["visuals"]] == ["clusteredColumnChart"]
    assert inv["visuals"][0]["fields"] == ["Revenue"]
    assert inv["measures"] == [{"name": "Total", "expression": "SUM(\nSales[Revenue])"}]
    assert [t["name"] for t in inv["tables"]] == ["Sales"]


@pytest.mark.parametrize("name,data", [
    ("evil.twb", b"<!-- " + b"x" * 5000 + b" --><!DOCTYPE a [<!ENTITY b 'c'>]><workbook/>"),
    ("broken.pbix", b"not a zip"),
    ("notes.docx", b"PK"),
])
def test_unsafe_or_wrong_files_are_refused(name, data):
    with pytest.raises(PackageError):
        read_package(name, data)


def test_goal_quotes_the_report_as_data():
    goal = goal_for("sales.twb", read_package("sales.twb", TWB), note="Use the orders table")
    assert "not instructions" in goal and "From the person: Use the orders table" in goal
    assert json.loads(goal.split("not instructions):\n", 1)[1])["pages"] == ["Overview"]


@pytest.mark.asyncio
async def test_dbt_export_is_metricflow_yaml(monkeypatch):
    import yaml

    from ee.modules.ai.services import semantic_layer_db as sl
    from ee.modules.semantic.dbt_io import export_metricflow

    async def metrics(**_):
        return [{"name": "Total revenue", "expression": "SUM(amount)", "source_ref": "orders"},
                {"name": "Customers", "expression": "count_distinct(customer_id)", "source_ref": "orders"}]

    async def dimensions(**_):
        return [{"name": "Region", "expression": "region", "source_ref": "orders"}]

    monkeypatch.setattr(sl.semantic_layer_db, "list_metrics", metrics)
    monkeypatch.setattr(sl.semantic_layer_db, "list_dimensions", dimensions)
    doc = yaml.safe_load(await export_metricflow("ds", None))
    model = doc["semantic_models"][0]
    assert model["name"] == "orders" and model["model"] == "ref('orders')"
    assert model["measures"] == [{"name": "total_revenue", "agg": "sum", "expr": "amount"},
                                 {"name": "customers", "agg": "count_distinct", "expr": "customer_id"}]
    assert model["dimensions"][0]["name"] == "region"
    assert {m["name"] for m in doc["metrics"]} == {"total_revenue", "customers"}


def test_changed_fields_names_only_differences():
    from src.shared.asset_revisions import changed_fields

    assert changed_fields({"title": "a", "chart_type": "bar"}, {"title": "b", "chart_type": "bar"}) == ["title"]
    assert changed_fields({"x": 1}, {"x": 1}) == []


def test_idle_model_caches_are_emptied_and_used_ones_kept(monkeypatch):
    from src.shared import model_loading as ml

    idle, busy = {"m": object()}, {"m": object()}
    monkeypatch.setattr(ml, "_caches", {})
    monkeypatch.setattr(ml, "_last_used", {})
    ml.track("idle", idle)
    ml.track("busy", busy)
    ml._last_used["idle"] -= 3600
    assert ml.unload_idle(1800) == 1
    assert idle == {} and "m" in busy
    assert ml.unload_idle(1800) == 0  # already empty: nothing to do


def test_action_tools_ask_every_time_and_stay_off_mcp():
    from src.core.tool_registry import ToolTier, get_tool_registry
    import ee.modules.activation.agent_tools  # noqa: F401

    reg = get_tool_registry()
    for name in ("send_to_destination", "create_crm_task"):
        spec = reg.get(name)
        assert spec.tier == ToolTier.EXTERNAL and "mcp" not in spec.surfaces
    assert reg.get("list_destinations").tier == ToolTier.READ


@pytest.mark.asyncio
async def test_send_needs_a_heading_and_crm_needs_a_system():
    from ee.modules.activation.agent_tools import create_crm_task, send_to_destination
    from src.core.tool_registry import ToolCaller, ToolError

    caller = ToolCaller(user_id="u", organization_id="o")
    with pytest.raises(ToolError):
        await send_to_destination(caller, {"destination_id": "x"})
    with pytest.raises(ToolError):
        await create_crm_task(caller, {"system": "zoho", "subject": "Call"})
