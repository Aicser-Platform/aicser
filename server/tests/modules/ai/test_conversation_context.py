"""Tests for cross-turn conversation context helpers."""

from ee.modules.ai.utils.conversation_context import (
    build_conversation_analytics_context,
    extract_last_sql_from_conversation_history,
    time_grain_refinement_likely,
)


def test_extract_last_sql_most_recent_assistant():
    hist = [
        {"role": "user", "content": "sales per day"},
        {"role": "assistant", "content": "ok", "sql_query": "SELECT 1 AS old"},
        {"role": "user", "content": "monthly"},
        {"role": "assistant", "content": "done", "sql_query": "SELECT 2 AS new"},
    ]
    assert "SELECT 2" in (extract_last_sql_from_conversation_history(hist) or "")


def test_extract_last_sql_skips_select_star_preview():
    from ee.modules.ai.utils.conversation_context import sql_is_unhelpful_history_base

    hist = [
        {"role": "user", "content": "preview"},
        {"role": "assistant", "content": "ok", "sql_query": "SELECT * FROM accounts LIMIT 50"},
        {"role": "user", "content": "how many customers per month"},
        {"role": "assistant", "content": "done", "sql_query": "SELECT date_trunc('month', created_at) AS period, COUNT(*) FROM accounts GROUP BY 1"},
    ]
    assert sql_is_unhelpful_history_base("SELECT * FROM accounts LIMIT 50") is True
    sql = extract_last_sql_from_conversation_history(hist) or ""
    assert "GROUP BY" in sql
    assert "SELECT *" not in sql.upper().replace(" ", " ")


def test_extract_last_sql_ignores_preview_when_it_is_the_only_sql():
    hist = [
        {"role": "user", "content": "show me the table"},
        {"role": "assistant", "content": "here", "sql_query": "SELECT * FROM customers LIMIT 20"},
    ]
    assert extract_last_sql_from_conversation_history(hist) is None


def test_time_grain_refinement_likely():
    assert time_grain_refinement_likely("show me monthly") is True
    assert time_grain_refinement_likely("sales by week") is True
    assert time_grain_refinement_likely("total revenue") is False


def test_build_conversation_analytics_context_time_grain_hint():
    hist = [
        {"role": "user", "content": "sales per day"},
        {"role": "assistant", "content": "ok", "sql_query": "SELECT day, sum(s) FROM t GROUP BY 1"},
    ]
    ctx = build_conversation_analytics_context(hist, "show monthly")
    assert ctx.get("continuation_hint") == "time_grain"
    assert ctx.get("has_prior_analytic_turn") is True
    assert "GROUP BY" in (ctx.get("last_sql") or "")


def test_build_conversation_analytics_context_pronoun():
    hist = [
        {"role": "user", "content": "top products"},
        {"role": "assistant", "sql_query": "SELECT x FROM p"},
    ]
    ctx = build_conversation_analytics_context(hist, "break that down by region")
    assert ctx.get("continuation_hint") == "pronoun_follow_up"
