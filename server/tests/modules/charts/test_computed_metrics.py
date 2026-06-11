"""Unit tests for the computed (ratio) metric compiler in the v2 chart engine.

Covers both the SQL path (DB sources) and the pandas path (file sources), plus
injection / fail-closed safety. These exercise pure helper methods, so no DB is
needed — we instantiate ChartService via __new__.
"""

import pandas as pd

from src.modules.charts.services.v2.chart_service import ChartService


def _svc() -> ChartService:
    # Pure helpers only; bypass __init__ (which would need a DB session).
    return ChartService.__new__(ChartService)


# ---------------------------------------------------------------------------
# Task 1 — SQL compiler
# ---------------------------------------------------------------------------

def test_build_metric_sql_ratio_with_filter():
    svc = _svc()
    ym = {
        "field": "par_30",
        "computed": {
            "type": "ratio",
            "numerator": {
                "aggregation": "sum",
                "field": "outstanding_balance_usd",
                "filter": [{"field": "max_days_late", "operator": ">=", "value": 30}],
            },
            "denominator": {"aggregation": "sum", "field": "outstanding_balance_usd"},
            "multiplier": 100,
        },
    }
    sql = svc._build_metric_sql(ym)
    assert sql == (
        "SUM(outstanding_balance_usd) FILTER (WHERE max_days_late >= 30) "
        "/ NULLIF(SUM(outstanding_balance_usd), 0) * 100"
    )


def test_build_metric_sql_ratio_no_multiplier():
    svc = _svc()
    ym = {
        "field": "collection_rate",
        "computed": {
            "type": "ratio",
            "numerator": {"aggregation": "sum", "field": "total_repaid_usd"},
            "denominator": {"aggregation": "sum", "field": "loan_amount_usd"},
        },
    }
    sql = svc._build_metric_sql(ym)
    assert sql == "SUM(total_repaid_usd) / NULLIF(SUM(loan_amount_usd), 0)"


def test_build_metric_sql_plain_falls_back():
    svc = _svc()
    assert svc._build_metric_sql({"field": "amount", "aggregation": "sum"}) == "SUM(amount)"


# ---------------------------------------------------------------------------
# Task 3 — safety / fail-closed
# ---------------------------------------------------------------------------

def test_computed_metric_rejects_injection_field():
    svc = _svc()
    ym = {
        "field": "bad",
        "computed": {
            "type": "ratio",
            "numerator": {"aggregation": "sum", "field": "a); DROP TABLE t;--"},
            "denominator": {"aggregation": "sum", "field": "a"},
        },
    }
    assert svc._build_metric_sql(ym) is None


def test_computed_metric_rejects_unknown_type():
    svc = _svc()
    ym = {
        "field": "x",
        "computed": {
            "type": "wat",
            "numerator": {"aggregation": "sum", "field": "a"},
            "denominator": {"aggregation": "sum", "field": "b"},
        },
    }
    assert svc._build_metric_sql(ym) is None


def test_computed_metric_clamps_bad_multiplier():
    svc = _svc()
    ym = {
        "field": "x",
        "computed": {
            "type": "ratio",
            "numerator": {"aggregation": "sum", "field": "a"},
            "denominator": {"aggregation": "sum", "field": "b"},
            "multiplier": 999,
        },
    }
    # multiplier not in {1, 100} → clamped to 1 (no '* N' suffix), never errors
    assert svc._build_metric_sql(ym) == "SUM(a) / NULLIF(SUM(b), 0)"


# ---------------------------------------------------------------------------
# Task 2 — pandas compiler (parity with SQL semantics)
# ---------------------------------------------------------------------------

def test_compute_metric_pandas_ratio_grouped():
    svc = _svc()
    df = pd.DataFrame(
        {
            "month": ["Jan", "Jan", "Feb", "Feb"],
            "outstanding_balance_usd": [100, 100, 200, 200],
            "max_days_late": [40, 0, 40, 10],
        }
    )
    ym = {
        "field": "par_30",
        "computed": {
            "type": "ratio",
            "numerator": {
                "aggregation": "sum",
                "field": "outstanding_balance_usd",
                "filter": [{"field": "max_days_late", "operator": ">=", "value": 30}],
            },
            "denominator": {"aggregation": "sum", "field": "outstanding_balance_usd"},
            "multiplier": 100,
        },
    }
    out = svc._compute_metric_pandas(df, ym, group_by=["month"])
    result = {row["month"]: round(row["par_30"]) for _, row in out.iterrows()}
    # Jan: 100/200*100 = 50 ; Feb: 200/400*100 = 50
    assert result == {"Jan": 50, "Feb": 50}


def test_compute_metric_pandas_ratio_ungrouped():
    svc = _svc()
    df = pd.DataFrame(
        {
            "total_repaid_usd": [50, 50, 100],
            "loan_amount_usd": [100, 100, 200],
        }
    )
    ym = {
        "field": "collection_rate",
        "computed": {
            "type": "ratio",
            "numerator": {"aggregation": "sum", "field": "total_repaid_usd"},
            "denominator": {"aggregation": "sum", "field": "loan_amount_usd"},
            "multiplier": 100,
        },
    }
    out = svc._compute_metric_pandas(df, ym, group_by=[])
    # 200 / 400 * 100 = 50
    assert round(out["collection_rate"].iloc[0]) == 50
