from ee.modules.ai.utils.insight_normalization import (
    ground_prose_pack,
    inject_query_result_into_insights,
    normalize_recommendations,
)
from ee.modules.ai.utils.metric_grounding import format_grounded_number


def test_ground_prose_pack_rewrites_insight_and_summary_from_executed_rows():
    formatted = format_grounded_number(5000, "revenue")
    pack = ground_prose_pack(
        insights=[{"title": "Revenue is 5000", "description": "Total revenue is 5,000"}],
        recommendations=[{"title": "Grow 5000", "description": "Push past 5000"}],
        executive_summary="Revenue landed at 5000 this period.",
        narration="The warehouse returned 5,000.",
        query_result=[{"revenue": 5000}],
    )
    assert formatted in pack["executive_summary"]
    assert formatted in pack["insights"][0]["description"]
    assert formatted in pack["narration"]


def test_ground_prose_pack_never_guesses_at_short_numbers():
    # "5" could be 5 thousand or 5 stores: rewriting it on a guess would corrupt a correct
    # sentence. Unsupported numbers are caught by narration grounding in the response finalizer.
    pack = ground_prose_pack(executive_summary="Revenue grew in 5 stores.", query_result=[{"revenue": 5000}])
    assert pack["executive_summary"] == "Revenue grew in 5 stores."


def test_inject_is_noop_without_rows():
    insights = [{"title": "Hold", "description": "No numbers yet"}]
    assert inject_query_result_into_insights(insights, None) == insights


def test_normalize_recommendations_still_exports():
    recs = normalize_recommendations(["Hire two analysts"])
    assert recs[0]["action"]
    assert recs[0]["title"]
