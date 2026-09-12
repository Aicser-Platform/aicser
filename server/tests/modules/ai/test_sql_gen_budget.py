"""Adaptive NL2SQL budget: simple questions stay fail-fast; enterprise work
gets a strong model and a longer but still bounded wait (never 90s×2).
"""

from ee.modules.ai.utils.sql_gen_budget import resolve_sql_gen_budget, timeout_fallback_for


def _schema(n_tables: int):
    return {"tables": [{"name": f"t{i}", "columns": [{"name": "id"}]} for i in range(n_tables)]}


def test_simple_forecast_sql_stays_fast_not_enterprise():
    """Forecast SQL is a time-bucket aggregate; Prophet runs after execute."""
    b = resolve_sql_gen_budget({
        "query": "how much amount customer loans monthly in total and forecast next 5 month",
        "analytics_type": "predictive",
        "query_intent": {"query_complexity": "simple"},
        "data_source_schema": _schema(6),
        "execution_metadata": {"query_complexity": "simple", "analysis_mode": "standard"},
    })
    assert b.band == "simple"
    assert b.use_strong_model is False
    assert b.timeout_s <= 45.0


def test_predictive_does_not_force_enterprise_sql_budget():
    b = resolve_sql_gen_budget({
        "query": "forecast this metric for the next 6 months",
        "analytics_type": "predictive",
        "query_intent": {"query_complexity": "simple"},
        "data_source_schema": _schema(6),
    })
    assert b.band != "enterprise"
    assert b.use_strong_model is False


def test_simple_how_many_lookup_stays_fast_even_if_complexity_defaults_moderate():
    b = resolve_sql_gen_budget({
        "query": "how many customers with loan amount > 100$",
        "analytics_type": "descriptive",
        "analysis_mode": "standard",
        "query_intent": {"query_complexity": "moderate"},
        "data_source_schema": _schema(7),
    })
    assert b.band == "simple"
    assert b.use_strong_model is False
    assert b.timeout_s <= 45.0


def test_simple_top_n_stays_fast():
    b = resolve_sql_gen_budget({
        "query": "how much amount loan per top 10 customers",
        "analytics_type": "descriptive",
        "query_intent": {"query_complexity": "simple"},
        "data_source_schema": _schema(6),
        "execution_metadata": {"query_complexity": "simple", "analysis_mode": "standard"},
    })
    assert b.band == "simple"
    assert b.timeout_s <= 45.0
    assert b.max_tokens <= 4096
    assert b.use_strong_model is False


def test_simple_total_lookup_also_caps_timeout():
    b = resolve_sql_gen_budget({
        "query": "what is the total loan amount",
        "analytics_type": "descriptive",
        "analysis_mode": "standard",
        "query_intent": {"query_complexity": "moderate"},
        "data_source_schema": _schema(7),
    })
    assert b.band == "simple"
    assert b.timeout_s <= 45.0


def test_warehouse_table_count_gets_moderate_headroom():
    b = resolve_sql_gen_budget({
        "query": "revenue by region",
        "analytics_type": "descriptive",
        "query_intent": {"query_complexity": "simple"},
        "data_source_schema": _schema(12),
        "execution_metadata": {"analysis_mode": "standard"},
    })
    assert b.band == "moderate"
    assert b.timeout_s >= 25.0
    assert b.max_tokens >= 6144
    assert b.use_strong_model is False


def test_large_warehouse_uses_enterprise_strong_model():
    warehouse = resolve_sql_gen_budget({
        "query": "revenue by region",
        "analytics_type": "descriptive",
        "query_intent": {"query_complexity": "simple"},
        "data_source_schema": _schema(40),
    })
    assert warehouse.band == "enterprise"
    assert warehouse.use_strong_model is True
    assert warehouse.timeout_s >= 40.0
    assert warehouse.max_tokens >= 8192
    assert warehouse.timeout_s <= 90.0


def test_diagnostic_why_stays_fast_sql_even_when_intent_is_complex():
    """Diagnose is hard analysis, not hard NL2SQL. The engine runs after execute."""
    b = resolve_sql_gen_budget({
        "query": "why did loan defaults rise last quarter",
        "analytics_type": "diagnostic",
        "query_intent": {"query_complexity": "complex"},
        "data_source_schema": _schema(8),
    })
    assert b.band == "simple"
    assert b.use_strong_model is False
    assert b.timeout_s <= 45.0


def test_federated_is_enterprise_but_why_wording_is_not():
    fed = resolve_sql_gen_budget({
        "query": "compare sales across sources",
        "federated_plan_active": True,
        "data_source_schema": _schema(3),
        "query_intent": {"query_complexity": "simple"},
        "analytics_type": "descriptive",
    })
    assert fed.band == "enterprise"

    why = resolve_sql_gen_budget({
        "query": "why did churn increase last quarter",
        "analytics_type": "descriptive",
        "query_intent": {"query_complexity": "simple"},
        "data_source_schema": _schema(4),
    })
    assert why.band != "enterprise"
    assert why.use_strong_model is False


def test_local_model_gets_longer_bound_not_unbounded():
    b = resolve_sql_gen_budget({
        "query": "top 10 customers",
        "query_intent": {"query_complexity": "simple"},
        "analytics_type": "descriptive",
        "data_source_schema": _schema(3),
        "execution_metadata": {"model_used": "ollama/qwen2.5"},
    })
    assert b.band == "simple"
    assert 45.0 <= b.timeout_s <= 90.0


def test_timeout_fallback_never_repeats_90s():
    assert timeout_fallback_for(15.0) == 15.0
    assert timeout_fallback_for(45.0) == 27.0
    assert timeout_fallback_for(90.0) == 40.0
    assert timeout_fallback_for(60.0) == 36.0
    assert timeout_fallback_for(22.0) == 15.0


def test_engine_heavy_modes_stay_fast_sql_unless_query_is_complex():
    """Diagnose / Optimise / Decide SQL is a fact pull; engines run after execute."""
    for analytics in ("diagnostic", "prescriptive", "decision_intelligence", "animate"):
        b = resolve_sql_gen_budget({
            "query": "show monthly loan totals",
            "analytics_type": analytics,
            "analysis_mode": "standard",
            "query_intent": {"query_complexity": "moderate"},
            "data_source_schema": _schema(6),
        })
        assert b.band == "simple", analytics
        assert b.use_strong_model is False
        assert b.timeout_s <= 45.0


def test_leftover_decision_intelligence_mode_does_not_force_enterprise_sql():
    b = resolve_sql_gen_budget({
        "query": "what should we decide next?",
        "analytics_type": "decision_intelligence",
        "analysis_mode": "decision_intelligence",
        "query_intent": {"query_complexity": "simple"},
        "data_source_schema": _schema(6),
    })
    assert b.band == "simple"
    assert b.use_strong_model is False


def test_analytics_render_budget_leaves_room_for_insight_llm():
    from ee.modules.ai.config.workflow_config import WorkflowConfig

    # Chart is rule-based; remaining wall-clock is the insight narrator.
    # Budget must cover a full insight primary + one retry on slow BYOK.
    cap = WorkflowConfig.ANALYTICS_RENDER_BUDGET_S
    assert WorkflowConfig.analytics_render_budget_s("predictive") <= cap
    assert WorkflowConfig.analytics_render_budget_s("descriptive") >= WorkflowConfig.INSIGHT_TIMEOUT
    assert WorkflowConfig.analytics_render_budget_s("descriptive") <= cap
    assert WorkflowConfig.analytics_render_budget_s("diagnostic") <= cap
    assert WorkflowConfig.analytics_render_budget_s("prescriptive") <= cap
    assert WorkflowConfig.analytics_render_budget_s("decision_intelligence") <= cap
    assert WorkflowConfig.analytics_render_budget_s("animate") <= cap
    assert WorkflowConfig.INSIGHT_FAST_TIMEOUT >= 20.0
    assert WorkflowConfig.INSIGHT_TIMEOUT >= WorkflowConfig.INSIGHT_FAST_TIMEOUT
    assert WorkflowConfig.INSIGHT_TIMEOUT >= 30.0
    assert WorkflowConfig.SQL_TIMEOUT_STANDARD >= 30.0
    assert WorkflowConfig.DIAGNOSTIC_ENGINE_TIMEOUT_S <= 10.0
    assert WorkflowConfig.PRESCRIPTIVE_ENGINE_TIMEOUT_S <= 10.0
    assert WorkflowConfig.PREDICTIVE_ENGINE_TIMEOUT_S <= 8.0
