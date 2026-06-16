"""Tests for chat→dashboard metric accuracy: per-widget filters, computed (ratio)
metrics, deterministic guardrails, and label sanitization.

These are general-purpose (any industry); the finance/retail fixtures are just
two concrete shapes to assert the produced chart_query against.
"""

import pytest

from src.modules.ai.schemas.dashboard_plan import DashboardWidgetPlan


# ---------------------------------------------------------------------------
# Task 4 — schema supports filters + computed
# ---------------------------------------------------------------------------

def test_widget_plan_accepts_filters_and_computed():
    w = DashboardWidgetPlan(
        title="Active portfolio",
        chart_type="stat",
        layout={"x": 0, "y": 0, "w": 3, "h": 4},
        table_name="loans",
        y_metric="loan_amount_usd",
        aggregation="sum",
        filters=[{"field": "loan_status", "operator": "=", "value": "Active"}],
    )
    dumped = w.model_dump()
    assert dumped["filters"][0]["field"] == "loan_status"

    par = DashboardWidgetPlan(
        title="PAR-30",
        chart_type="stat",
        layout={"x": 3, "y": 0, "w": 3, "h": 4},
        table_name="loans",
        computed={
            "type": "ratio",
            "numerator": {"aggregation": "sum", "field": "outstanding_balance_usd",
                          "filter": [{"field": "max_days_late", "operator": ">=", "value": 30}]},
            "denominator": {"aggregation": "sum", "field": "outstanding_balance_usd"},
            "multiplier": 100,
        },
    )
    cdump = par.model_dump()
    assert cdump["computed"]["type"] == "ratio"
    assert cdump["computed"]["numerator"]["filter"][0]["field"] == "max_days_late"


# ---------------------------------------------------------------------------
# Task 5 — planner emits filters + computed into chart_query
# ---------------------------------------------------------------------------

FINANCE_SCHEMA = {
    "tables": [
        {
            "name": "loans",
            "columns": [
                {"name": "loan_id", "type": "string"},
                {"name": "loan_status", "type": "string"},
                {"name": "loan_amount_usd", "type": "number"},
                {"name": "outstanding_balance_usd", "type": "number"},
                {"name": "total_repaid_usd", "type": "number"},
                {"name": "max_days_late", "type": "integer"},
                {"name": "branch_id", "type": "string"},
                {"name": "disbursement_date", "type": "string"},
            ],
        }
    ]
}


def test_widget_to_internal_emits_filters():
    from ee.modules.ai.services.dashboard_llm_planner import _widget_plan_to_internal

    w = DashboardWidgetPlan(
        title="Total active portfolio",
        chart_type="stat",
        layout={"x": 0, "y": 0, "w": 3, "h": 4},
        table_name="loans",
        y_metric="loan_amount_usd",
        aggregation="sum",
        filters=[{"field": "loan_status", "operator": "=", "value": "Active"}],
    )
    internal = _widget_plan_to_internal(w, page_role="overview", detail_page_id=None, schema=FINANCE_SCHEMA)
    cq = internal["chart_query"]
    assert cq["filters"] == [{"field": "loan_status", "operator": "=", "value": "Active"}]
    assert cq["yMetrics"][0]["field"] == "loan_amount_usd"


def test_widget_to_internal_emits_computed():
    from ee.modules.ai.services.dashboard_llm_planner import _widget_plan_to_internal

    w = DashboardWidgetPlan(
        title="PAR-30",
        chart_type="stat",
        layout={"x": 3, "y": 0, "w": 3, "h": 4},
        table_name="loans",
        computed={
            "type": "ratio",
            "numerator": {"aggregation": "sum", "field": "outstanding_balance_usd",
                          "filter": [{"field": "max_days_late", "operator": ">=", "value": 30}]},
            "denominator": {"aggregation": "sum", "field": "outstanding_balance_usd"},
            "multiplier": 100,
        },
    )
    internal = _widget_plan_to_internal(w, page_role="overview", detail_page_id=None, schema=FINANCE_SCHEMA)
    cq = internal["chart_query"]
    ym = cq["yMetrics"][0]
    assert ym["computed"]["type"] == "ratio"
    assert ym["computed"]["numerator"]["field"] == "outstanding_balance_usd"


def test_widget_to_internal_drops_filter_with_unknown_column():
    from ee.modules.ai.services.dashboard_llm_planner import _widget_plan_to_internal

    w = DashboardWidgetPlan(
        title="Bad filter",
        chart_type="stat",
        layout={"x": 0, "y": 0, "w": 3, "h": 4},
        table_name="loans",
        y_metric="loan_amount_usd",
        aggregation="sum",
        filters=[{"field": "not_a_real_column", "operator": "=", "value": "x"}],
    )
    internal = _widget_plan_to_internal(w, page_role="overview", detail_page_id=None, schema=FINANCE_SCHEMA)
    assert internal["chart_query"].get("filters", []) == []


# ---------------------------------------------------------------------------
# Task 8 — deterministic validator (guardrails)
# ---------------------------------------------------------------------------

def _internal(name, chart_query, chart_type="bar"):
    return {"name": name, "chart_type": chart_type, "chart_query": chart_query}


def test_validator_drops_surrogate_key_metric():
    from ee.modules.ai.services.dashboard_widget_validator import validate_widgets

    w = _internal("Loans by branch", {
        "tableName": "loans", "x": "branch_id",
        "yMetrics": [{"field": "loan_id", "aggregation": "sum"}], "filters": [],
    })
    kept, dropped = validate_widgets([w], FINANCE_SCHEMA)
    assert kept == []
    assert dropped and "loan_id" in dropped[0]["reason"]


def test_validator_drops_unknown_column():
    from ee.modules.ai.services.dashboard_widget_validator import validate_widgets

    w = _internal("Bad", {
        "tableName": "loans", "x": "not_a_column",
        "yMetrics": [{"field": "loan_amount_usd", "aggregation": "sum"}], "filters": [],
    })
    kept, dropped = validate_widgets([w], FINANCE_SCHEMA)
    assert kept == []
    assert dropped and "not_a_column" in dropped[0]["reason"]


def test_validator_collapses_second_categorical_dimension():
    from ee.modules.ai.services.dashboard_widget_validator import validate_widgets

    w = _internal("Mixed", {
        "tableName": "loans", "x": "branch_id", "group_field": "loan_status",
        "yMetrics": [{"field": "loan_amount_usd", "aggregation": "sum"}], "filters": [],
    })
    kept, dropped = validate_widgets([w], FINANCE_SCHEMA)
    assert len(kept) == 1
    assert "group_field" not in kept[0]["chart_query"]


def test_validator_keeps_valid_filtered_and_computed():
    from ee.modules.ai.services.dashboard_widget_validator import validate_widgets

    filtered = _internal("Active portfolio", {
        "tableName": "loans",
        "yMetrics": [{"field": "loan_amount_usd", "aggregation": "sum"}],
        "filters": [{"field": "loan_status", "operator": "=", "value": "Active"}],
    }, chart_type="stat")
    computed = _internal("PAR-30", {
        "tableName": "loans",
        "yMetrics": [{"field": "par_30", "computed": {
            "type": "ratio",
            "numerator": {"aggregation": "sum", "field": "outstanding_balance_usd",
                          "filter": [{"field": "max_days_late", "operator": ">=", "value": 30}]},
            "denominator": {"aggregation": "sum", "field": "outstanding_balance_usd"},
            "multiplier": 100}}],
        "filters": [],
    }, chart_type="stat")
    text = {"name": "Summary", "chart_type": "text", "chart_query": {}}
    kept, dropped = validate_widgets([filtered, computed, text], FINANCE_SCHEMA)
    assert len(kept) == 3 and dropped == []


# ---------------------------------------------------------------------------
# Task 9 — label sanitizer
# ---------------------------------------------------------------------------

def test_humanize_label():
    from ee.modules.ai.services.dashboard_widget_validator import humanize_label

    assert humanize_label("outstanding_balance_usd") == "Outstanding Balance USD"
    assert humanize_label("recordCount") == "Record Count"
    assert humanize_label("total_repaid_usd") == "Total Repaid USD"


# ---------------------------------------------------------------------------
# Task 6 — semantic grounding (real values into the prompt)
# ---------------------------------------------------------------------------

def test_profile_columns_categorical_and_numeric():
    from ee.modules.ai.services.dashboard_semantic_grounding import (
        profile_columns, format_profile_for_prompt,
    )
    rows = [
        {"loan_status": "Active", "loan_amount_usd": 100, "branch_id": "B1", "max_days_late": 0},
        {"loan_status": "Closed", "loan_amount_usd": 300, "branch_id": "B2", "max_days_late": 40},
        {"loan_status": "Active", "loan_amount_usd": 200, "branch_id": "B1", "max_days_late": 10},
    ]
    prof = profile_columns(FINANCE_SCHEMA, rows)
    assert set(prof["loan_status"]["values"]) == {"Active", "Closed"}
    assert prof["loan_amount_usd"]["kind"] == "numeric"
    assert prof["loan_amount_usd"]["min"] == 100 and prof["loan_amount_usd"]["max"] == 300
    txt = format_profile_for_prompt(prof)
    assert "loan_status" in txt and "Active" in txt


def test_profile_columns_empty_sample_is_safe():
    from ee.modules.ai.services.dashboard_semantic_grounding import profile_columns
    assert profile_columns(FINANCE_SCHEMA, []) == {}


# ---------------------------------------------------------------------------
# Task 7 — domain auto-detection hint
# ---------------------------------------------------------------------------

def test_build_domain_hint_detects_and_falls_back():
    from ee.modules.ai.services.dashboard_semantic_grounding import build_domain_hint
    assert build_domain_hint(FINANCE_SCHEMA) != ""
    unknown = {"tables": [{"name": "t", "columns": [{"name": "col_a", "type": "string"}]}]}
    assert build_domain_hint(unknown) == ""


# ---------------------------------------------------------------------------
# Task 10 — cross-industry integration goldens
# ---------------------------------------------------------------------------

RETAIL_SCHEMA = {
    "tables": [
        {
            "name": "orders",
            "columns": [
                {"name": "order_id", "type": "string"},
                {"name": "order_status", "type": "string"},
                {"name": "revenue", "type": "number"},
                {"name": "category", "type": "string"},
            ],
        }
    ]
}


def test_retail_conversion_rate_computed():
    """The same ratio primitive serves retail (conversion rate) — not finance-only."""
    from ee.modules.ai.services.dashboard_llm_planner import _widget_plan_to_internal

    w = DashboardWidgetPlan(
        title="Conversion rate",
        chart_type="stat",
        layout={"x": 0, "y": 0, "w": 3, "h": 4},
        table_name="orders",
        computed={
            "type": "ratio",
            "numerator": {"aggregation": "count", "field": "order_id",
                          "filter": [{"field": "order_status", "operator": "=", "value": "Completed"}]},
            "denominator": {"aggregation": "count", "field": "order_id"},
            "multiplier": 100,
        },
    )
    internal = _widget_plan_to_internal(w, page_role="overview", detail_page_id=None, schema=RETAIL_SCHEMA)
    assert internal["chart_query"]["yMetrics"][0]["computed"]["type"] == "ratio"


def test_materialize_runs_validator_and_labels():
    """End-to-end materialize: surrogate-key widget dropped, raw label humanized."""
    from src.modules.ai.schemas.dashboard_plan import DashboardLLMPlan, DashboardPagePlan
    from ee.modules.ai.services.dashboard_llm_planner import materialize_dashboard_plan

    plan = DashboardLLMPlan(
        dashboard_title="Test",
        pages=[
            DashboardPagePlan(
                role="overview",
                name="Overview",
                widgets=[
                    DashboardWidgetPlan(
                        title="loan_amount_usd", chart_type="bar",
                        layout={"x": 0, "y": 0, "w": 6, "h": 5}, table_name="loans",
                        x="branch_id", y_metric="loan_amount_usd", aggregation="sum",
                    ),
                    DashboardWidgetPlan(
                        title="Bad metric", chart_type="bar",
                        layout={"x": 6, "y": 0, "w": 6, "h": 5}, table_name="loans",
                        x="branch_id", y_metric="loan_id", aggregation="sum",
                    ),
                ],
            )
        ],
    )
    meta, widgets = materialize_dashboard_plan(plan, FINANCE_SCHEMA, detail_page_id="__d__")
    names = [w["name"] for w in widgets]
    assert "Bad metric" not in names           # surrogate-key metric dropped
    assert meta.get("dropped_widgets")
    assert "Loan Amount USD" in names          # raw snake_case label humanized
