"""Unit tests for follow-up / guided chip sanitizer."""

from ee.modules.ai.utils.follow_up_sanitizer import (
    finalize_follow_up_questions,
    questions_too_similar,
    sanitize_follow_up_questions,
)


def test_echo_of_current_query_removed():
    out = sanitize_follow_up_questions(
        [
            "How many customers are there?",
            "Revenue by region last quarter",
        ],
        current_query="how many customers are there",
    )
    assert out == ["Revenue by region last quarter"]


def test_near_paraphrase_removed():
    assert questions_too_similar(
        "show me sales by region",
        "Show me sales by region?",
    )
    out = sanitize_follow_up_questions(
        ["Show me sales by region?", "Forecast revenue next 6 months"],
        current_query="show me sales by region",
        is_pro=True,
    )
    assert out == ["Forecast revenue next 6 months"]


def test_free_plan_drops_pro_mode_chips_keeps_forecast():
    """Forecast is Free-eligible; diagnostic / prescriptive / executive report are not."""
    out = sanitize_follow_up_questions(
        [
            "Why did revenue change?",
            "Top 10 products by revenue",
            "Forecast monthly revenue for next 6 months",
            "What actions would improve revenue?",
            "Generate a comprehensive executive report with all key insights",
        ],
        current_query="total revenue",
        is_pro=False,
    )
    assert out == [
        "Top 10 products by revenue",
        "Forecast monthly revenue for next 6 months",
    ]


def test_pro_cache_then_free_egress_plan_filter():
    """Discover cache stores Pro-complete set; Free egress must still drop Pro chips."""
    cached = sanitize_follow_up_questions(
        [
            "Why did revenue change?",
            "Top 10 products by revenue",
            "Forecast monthly revenue for next 6 months",
        ],
        is_pro=True,
    )
    free = sanitize_follow_up_questions(cached, is_pro=False)
    assert free == [
        "Top 10 products by revenue",
        "Forecast monthly revenue for next 6 months",
    ]


def test_finalize_follow_up_questions_writes_state():
    state = {
        "query": "show revenue by region",
        "data_source_id": "ds-1",
        "agent_context": {"is_pro": False},
        "follow_up_questions": [
            "Show revenue by region",
            "Why did revenue change?",
            "Compare revenue across product",
        ],
        "conversation_history": [
            {"role": "user", "content": "show revenue by region"},
        ],
    }
    out = finalize_follow_up_questions(state)
    assert "Show revenue by region" not in out
    assert "Why did revenue change?" not in out
    assert any("Compare" in q for q in out)
    assert state["follow_up_questions"] == out


def test_generic_and_within_list_near_dupes_dropped():
    out = sanitize_follow_up_questions(
        [
            "Tell me more",
            "Revenue by region",
            "revenue by region?",
            "Top products by revenue",
        ],
        current_query="something else",
    )
    assert out == ["Revenue by region", "Top products by revenue"]
