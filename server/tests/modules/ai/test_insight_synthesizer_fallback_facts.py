"""Fallback narration must not impersonate an analyst with min/max fact cards."""

import pytest

from ee.modules.ai.nodes.insight_synthesizer_node import (
    _build_fallback_insights_from_facts,
    _build_fallback_summary,
    _compute_data_facts,
    _is_scalar_kpi_result,
    _recovered_stream_summary,
)


def test_ordinary_facts_do_not_become_insight_cards():
    facts = [
        "Total Rows: 5",
        "avg_loan_amount: Total=269,765.38, Avg=53,953.08, Min=44,177.78, Max=68,999.61",
        "Top name: 'Ada' (1 rows, 20.0%)",
    ]
    assert _build_fallback_insights_from_facts(facts, query="top customers", n_rows=5) == []


def test_compute_data_facts_includes_dimension_ranking():
    facts = _compute_data_facts([
        {"branch_name": "Branch 5", "collateral_amount": 210084.52},
        {"branch_name": "Branch 5", "collateral_amount": 196250.91},
        {"branch_name": "Branch 1", "collateral_amount": 142678.87},
        {"branch_name": "Branch 1", "collateral_amount": 26952.41},
    ])
    ranking = next((f for f in facts if " by " in f), "")
    assert "collateral_amount by branch_name" in ranking
    assert "Branch 5=" in ranking
    assert "Branch 1=" in ranking


def test_empty_facts_list_produces_no_cards():
    assert _build_fallback_insights_from_facts([]) == []


def test_schema_dump_column_titles_are_detected():
    from ee.modules.ai.nodes.insight_synthesizer_node import (
        _insights_are_schema_dump,
        _looks_like_schema_dump_insight,
        _summary_looks_like_column_dump,
    )

    assert _looks_like_schema_dump_insight({"title": "accounts_over_100", "what": "80"})
    assert _looks_like_schema_dump_insight({"title": "Total Rows", "what": "1"})
    assert not _looks_like_schema_dump_insight(
        {"title": "Accounts above $100", "what": "80 accounts currently exceed $100."}
    )
    assert _insights_are_schema_dump(
        [
            {"title": "accounts_over_100", "what": "Total=80"},
            {"title": "total_accounts", "what": "Total=100"},
            {"title": "pct_over_100", "what": "80%"},
        ]
    )
    assert _summary_looks_like_column_dump(
        "Based on 1 records: accounts_over_100: Total=80.00, Avg=80.00, Min=80.00, Max=80.00"
    )


def test_query_asks_for_trend():
    from ee.modules.ai.utils.routing_utils import query_asks_for_trend

    assert query_asks_for_trend("how many customers per month over time")
    assert query_asks_for_trend("show monthly revenue by region")
    assert not query_asks_for_trend("how many accounts have balance over 100")


def test_scalar_kpi_shape():
    assert _is_scalar_kpi_result([{"total_customers": 40}]) is True
    assert _is_scalar_kpi_result([{"segment": "A", "count": 40}]) is False
    assert _is_scalar_kpi_result([{"a": 1}, {"b": 2}]) is False


@pytest.mark.asyncio
async def test_trend_query_does_not_skip_narrative_for_one_row():
    from ee.modules.ai.nodes.insight_synthesizer_node import insight_synthesizer_node

    out = await insight_synthesizer_node(
        {
            "query": "how many customers per month over time",
            "query_result": [{"accounts_over_100": 80}],
            "execution_metadata": {"needs_narrative": False, "needs_chart": False},
        },
        litellm_service=None,
    )
    assert not (out.get("execution_metadata") or {}).get("insights_skipped_by_plan")
    titles = [str(i.get("title") or "") for i in (out.get("insights") or [])]
    assert "accounts_over_100" not in titles
    assert "Based on 1 records" not in (out.get("executive_summary") or "")


@pytest.mark.asyncio
async def test_true_kpi_skip_humanizes_column_insights():
    from ee.modules.ai.nodes.insight_synthesizer_node import insight_synthesizer_node

    out = await insight_synthesizer_node(
        {
            "query": "how many accounts have balance over 100",
            "query_result": [{"accounts_over_100": 80}],
            "execution_metadata": {"needs_narrative": False},
        },
        litellm_service=None,
    )
    assert (out.get("execution_metadata") or {}).get("insights_skipped_by_plan") is True
    titles = [str(i.get("title") or "") for i in (out.get("insights") or [])]
    assert "accounts_over_100" not in titles
    assert all("confidence" not in i for i in (out.get("insights") or []))


def test_fallback_summary_prefers_streamed_paragraph():
    streamed = (
        "The top customers by average loan size are concentrated in a few names, "
        "with the leading average around 69 thousand."
    )
    summary = _build_fallback_summary(
        "how much amount loan per top 10 customers",
        5,
        ["avg_loan_amount: Total=1.00, Avg=1.00, Min=1.00, Max=1.00"],
        streamed,
    )
    assert "69 thousand" in summary
    assert "Based on 5 records" not in summary


def test_fallback_summary_without_stream_is_a_sentence():
    summary = _build_fallback_summary(
        "top 10 customers",
        5,
        ["avg_loan_amount: Total=269,765.38, Avg=53,953.08, Min=44,177.78, Max=68,999.61"],
        "",
    )
    assert "269,765.38" in summary
    assert "stands out" not in summary.lower()
    assert "averages" not in summary.lower()
    assert "Based on 5 records: avg_loan_amount" not in summary


def test_fallback_summary_leads_with_dimension_ranking():
    facts = [
        "Total Rows: 21",
        "collateral_amount by branch_name: Branch 5=706,463.88 (23.7%), Branch 2=609,031.13 (20.4%)",
        "collateral_amount: Total=2,979,683.62, Avg=141,889.70, Min=26,952.41, Max=240,016.72",
    ]
    summary = _build_fallback_summary("how much collateral amount by branch", 21, facts, "")
    assert "by branch name" in summary.lower()
    assert "Branch 5=706,463.88" in summary
    assert "collateral amount is 2,979,683.62" not in summary.lower()


def test_breakdown_facts_become_a_ranking_card():
    facts = [
        "Total Rows: 21",
        "collateral_amount by branch_name: Branch 5=706,463.88 (23.7%), Branch 2=609,031.13 (20.4%)",
    ]
    cards = _build_fallback_insights_from_facts(
        facts,
        query="how much collateral amount by branch",
        n_rows=21,
    )
    assert len(cards) == 1
    assert "branch" in cards[0]["title"].lower()
    assert "Branch 5=706,463.88" in cards[0]["what"]


def test_fallback_summary_flags_trend_mismatch_on_one_row():
    summary = _build_fallback_summary(
        "how many customers per month over time",
        1,
        ["accounts_over_100: Total=80.00, Avg=80.00, Min=80.00, Max=80.00"],
        "",
    )
    assert "snapshot" in summary.lower()
    assert "Based on 1 records" not in summary


def test_trend_mismatch_fallback_insights_are_not_column_cards():
    cards = _build_fallback_insights_from_facts(
        ["accounts_over_100: Total=80.00, Avg=80.00, Min=80.00, Max=80.00"],
        query="how many customers per month over time",
        n_rows=1,
    )
    assert len(cards) == 1
    assert "accounts_over_100" not in cards[0]["title"]
    assert "time series" in cards[0]["title"].lower() or "snapshot" in cards[0]["what"].lower()


@pytest.mark.asyncio
async def test_scalar_count_skips_llm_and_does_not_invent_minmax_insights():
    from ee.modules.ai.nodes.insight_synthesizer_node import insight_synthesizer_node

    out = await insight_synthesizer_node(
        {
            "query": "how many customers are there in total",
            "query_result": [{"total_customers": 40}],
            "execution_metadata": {"needs_narrative": True},
        },
        litellm_service=None,
    )
    summary = out.get("executive_summary") or ""
    assert (out.get("execution_metadata") or {}).get("insights_skipped_by_plan") is True
    assert "40" in summary
    assert "there are 40" in summary.lower()
    assert "averages" not in summary.lower()
    assert "$" not in summary
    # One KPI card is intentional; must not invent min/max analyst cards.
    insights = out.get("insights") or []
    assert len(insights) == 1
    assert insights[0].get("title") == "Key figure"
    assert "40" in str(insights[0].get("what") or "")
    assert out.get("recommendations") == []


@pytest.mark.asyncio
async def test_ranking_does_not_skip_narrative_even_if_plan_flag_false():
    """Breakdowns/rankings must narrate — a stale needs_narrative=False must not skip."""
    from ee.modules.ai.nodes.insight_synthesizer_node import insight_synthesizer_node

    out = await insight_synthesizer_node(
        {
            "query": "top 10 customers by loan amount",
            "query_result": [
                {"customer": "Ada", "avg_loan_amount": 69000},
                {"customer": "Ben", "avg_loan_amount": 52000},
            ],
            "execution_metadata": {"needs_narrative": False},
        },
        litellm_service=None,
    )
    assert not (out.get("execution_metadata") or {}).get("insights_skipped_by_plan")
    assert (out.get("executive_summary") or out.get("narration") or "").strip()


@pytest.mark.asyncio
async def test_get_insights_now_does_not_skip_scalar_kpi():
    from ee.modules.ai.nodes.insight_synthesizer_node import insight_synthesizer_node

    out = await insight_synthesizer_node(
        {
            "query": "get insights now",
            "query_result": [{"total_customers": 40}],
            "execution_metadata": {"needs_narrative": False, "needs_chart": False},
        },
        litellm_service=None,
    )
    assert not (out.get("execution_metadata") or {}).get("insights_skipped_by_plan")


@pytest.mark.asyncio
async def test_animate_does_not_skip_llm_narrative():
    from ee.modules.ai.nodes.insight_synthesizer_node import insight_synthesizer_node

    out = await insight_synthesizer_node(
        {
            "query": "animate loan volume by branch",
            "analytics_type": "animate",
            "query_result": [{"period": "2024-01", "category": "A", "value": 1}],
            "analytics_metadata": {
                "narration_hints": ["Branch A pulled ahead in Q1.", "Volume peaked in March."],
                "frames": [{}],
            },
            "execution_metadata": {},
        },
        litellm_service=None,
    )
    assert not (out.get("execution_metadata") or {}).get("insights_skipped_by_plan")
    assert (out.get("executive_summary") or out.get("narration") or "").strip()


@pytest.mark.asyncio
async def test_decision_intelligence_skips_discarded_insight_llm():
    """Decide narration is owned by the Decision Brief — skip this node's LLM."""
    from ee.modules.ai.nodes.insight_synthesizer_node import insight_synthesizer_node

    out = await insight_synthesizer_node(
        {
            "query": "what should we decide about loan concentration",
            "analytics_type": "decision_intelligence",
            "query_result": [{"segment": "Retail", "share": 0.42}],
            "execution_metadata": {"analysis_mode": "decision_intelligence"},
        },
        litellm_service=None,
    )
    assert (out.get("execution_metadata") or {}).get("insights_skipped_for_decision_brief") is True
    assert "Decision Brief" in (out.get("thinking_trace") or out.get("reasoning_trace") or "")
    assert out.get("insights") == []
    assert out.get("recommendations") == []


@pytest.mark.asyncio
async def test_forecast_does_not_skip_even_if_plan_says_quiet():
    from ee.modules.ai.nodes.insight_synthesizer_node import insight_synthesizer_node

    out = await insight_synthesizer_node(
        {
            "query": "forecast revenue next 6 months",
            "analytics_type": "predictive",
            "query_result": [{"period": "2024-01", "value": 100}, {"period": "2024-02", "value": 110}],
            "analytics_metadata": {"model_used": "prophet", "forecast": [{"date": "2024-03", "forecast": 120}]},
            "execution_metadata": {"needs_narrative": False},
        },
        litellm_service=None,
    )
    assert not (out.get("execution_metadata") or {}).get("insights_skipped_by_plan")


def test_plan_quiet_mode_output_shape():
    from ee.modules.ai.utils.routing_utils import plan_quiet_mode_output_shape

    assert plan_quiet_mode_output_shape("how many customers are there") == (False, False)
    assert plan_quiet_mode_output_shape("how many customers with loan amount > 100$") == (False, False)
    assert plan_quiet_mode_output_shape("what is the total loan amount") == (False, False)
    # Rankings / show-me keep chart + narration (users usually want insights)
    assert plan_quiet_mode_output_shape("top 10 customers by revenue") == (True, True)
    assert plan_quiet_mode_output_shape("revenue over time by month") == (True, True)
    assert plan_quiet_mode_output_shape("show me sales by region") == (True, True)
    assert plan_quiet_mode_output_shape("how much collateral amount by branch") == (True, True)
    assert plan_quiet_mode_output_shape("tell me about sales") == (True, True)
    assert plan_quiet_mode_output_shape("get insights now") == (True, True)
    assert plan_quiet_mode_output_shape("what does this mean") == (True, True)

    from ee.modules.ai.utils.routing_utils import clamp_needs_chart_narrative

    assert clamp_needs_chart_narrative("show me sales by region", False, False) == (True, True)
    assert clamp_needs_chart_narrative("how many customers are there", False, False) == (False, False)
