from ee.modules.ai.utils.insight_normalization import (
    ground_prose_pack,
    inject_query_result_into_insights,
    normalize_recommendations,
)
from ee.modules.ai.utils.metric_grounding import format_grounded_number


def test_ground_prose_pack_rewrites_insight_and_summary_from_executed_rows():
    formatted = format_grounded_number(5000, "revenue")
    pack = ground_prose_pack(
        insights=[{"title": "Revenue is 5", "description": "Total revenue is 5"}],
        recommendations=[{"title": "Grow 5", "description": "Push toward 5 more"}],
        executive_summary="Revenue landed at 5 this period.",
        narration="The warehouse returned 5.",
        query_result=[{"revenue": 5000}],
    )
    assert formatted in pack["executive_summary"]
    assert formatted in pack["insights"][0]["description"]
    assert formatted in pack["narration"]


def test_inject_is_noop_without_rows():
    insights = [{"title": "Hold", "description": "No numbers yet"}]
    assert inject_query_result_into_insights(insights, None) == insights


def test_normalize_recommendations_still_exports():
    recs = normalize_recommendations(["Hire two analysts"])
    assert recs[0]["action"]
    assert recs[0]["title"]
