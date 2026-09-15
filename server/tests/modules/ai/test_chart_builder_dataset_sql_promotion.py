"""chart_builder_node substitutes query_result with a mode-specific dataset from
multi-query execution (diagnostic breakdown / predictive timeseries / prescriptive
scenarios) — but historically left state["sql_query"] pointing at the original base
query. Since "Inspect SQL" in the chat UI reads state["sql_query"], the user saw the
wrong SQL for any chart actually built from one of these substituted datasets.
Each analysis_datasets entry carries its own executed `sql` (multi_query_execution_node.py);
chart_builder_node must promote it into state whenever it uses that dataset's data.
"""

import pytest

from ee.modules.ai.nodes.chart_builder_node import chart_builder_node


@pytest.mark.asyncio
async def test_each_multi_chart_carries_its_own_sql_not_the_base_query():
    """When chart_builder_node builds a secondary chart from a different
    analysis_datasets entry (multi-step / deep analysis reports), the resulting
    chart dict must carry that dataset's own sql_query — previously every chart
    in the carousel showed the identical top-level/base SQL regardless of which
    dataset actually built it."""
    state = {
        "query": "revenue analysis",
        "query_result": [
            {"month": "Jan", "revenue": 100},
            {"month": "Feb", "revenue": 200},
            {"month": "Mar", "revenue": 150},
        ],
        "query_intent": {},
        "analytics_type": "descriptive",
        "multi_step_results": [{"step": 1}, {"step": 2}],
        "analysis_datasets": {
            "step_2": {
                "sql": "SELECT region, SUM(revenue) AS revenue FROM sales GROUP BY region",
                "data": [
                    {"region": "East", "revenue": 300},
                    {"region": "West", "revenue": 250},
                    {"region": "North", "revenue": 90},
                ],
            },
            "step_3": {
                "sql": "SELECT channel, SUM(revenue) AS revenue FROM sales GROUP BY channel",
                "data": [
                    {"channel": "Online", "revenue": 400},
                    {"channel": "Retail", "revenue": 150},
                    {"channel": "Partner", "revenue": 60},
                ],
            },
        },
        "sql_query": "SELECT month, SUM(revenue) AS revenue FROM sales GROUP BY month",
    }

    out = await chart_builder_node(state)

    em = out.get("execution_metadata") or {}
    charts = em.get("complementary_charts") or em.get("deep_analysis_charts") or []
    assert len(charts) == 2

    assert out["echarts_config"]["sql_query"] == "SELECT month, SUM(revenue) AS revenue FROM sales GROUP BY month"
    assert charts[0]["sql_query"] == "SELECT month, SUM(revenue) AS revenue FROM sales GROUP BY month"
    # Second chart was built from step_2's data — must show step_2's own SQL, not the base query.
    assert charts[1]["sql_query"] == "SELECT region, SUM(revenue) AS revenue FROM sales GROUP BY region"


@pytest.mark.asyncio
async def test_diagnostic_breakdown_promotes_its_own_sql():
    state = {
        "query": "why did revenue drop",
        "query_result": [{"x": "base"}],
        "query_intent": {},
        "analytics_type": "diagnostic",
        "analysis_datasets": {
            "diag_breakdown__region": {
                "sql": "SELECT region, SUM(revenue) AS total FROM sales GROUP BY region",
                "data": [{"region": "East", "total": 100}, {"region": "West", "total": 50}],
            }
        },
        "sql_query": "SELECT SUM(revenue) FROM sales",
    }

    out = await chart_builder_node(state)

    assert out["sql_query"] == "SELECT region, SUM(revenue) AS total FROM sales GROUP BY region"


@pytest.mark.asyncio
async def test_prescriptive_scenarios_promotes_its_own_sql():
    state = {
        "query": "what should we do to increase revenue",
        "query_result": [{"x": "base"}],
        "query_intent": {},
        "analytics_type": "prescriptive",
        "analysis_datasets": {
            "presc_scenarios": {
                "sql": "SELECT scenario, projected_revenue FROM scenarios",
                "data": [{"scenario": "A", "projected_revenue": 100}],
            }
        },
        "sql_query": "SELECT SUM(revenue) FROM sales",
    }

    out = await chart_builder_node(state)

    assert out["sql_query"] == "SELECT scenario, projected_revenue FROM scenarios"


@pytest.mark.asyncio
async def test_derived_dataset_with_no_sql_keeps_base_query():
    """An in-memory-derived dataset (fallback from base, no fresh query executed)
    carries sql="" — the base query is genuinely what ran, so it must not be
    overwritten with an empty string."""
    state = {
        "query": "why did revenue drop",
        "query_result": [{"x": "base"}],
        "query_intent": {},
        "analytics_type": "diagnostic",
        "analysis_datasets": {
            "diag_breakdown__region": {
                "sql": "",
                "data": [{"region": "East", "total": 100}],
            }
        },
        "sql_query": "SELECT SUM(revenue) FROM sales",
    }

    out = await chart_builder_node(state)

    assert out["sql_query"] == "SELECT SUM(revenue) FROM sales"


@pytest.mark.asyncio
async def test_no_matching_dataset_keeps_base_query_and_result():
    state = {
        "query": "why did revenue drop",
        "query_result": [{"region": "East", "total": 100}],
        "query_intent": {},
        "analytics_type": "diagnostic",
        "analysis_datasets": {},
        "sql_query": "SELECT region, SUM(revenue) AS total FROM sales GROUP BY region",
    }

    out = await chart_builder_node(state)

    assert out["sql_query"] == "SELECT region, SUM(revenue) AS total FROM sales GROUP BY region"
