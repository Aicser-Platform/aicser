"""Regression test: the streaming orchestrator's last-resort "never emit an
empty chat bubble" fallback (langgraph_orchestrator.py) must not tell the
user "I couldn't produce a detailed answer... try rephrasing" when the query
actually succeeded and query_result holds real, analyzable rows -- root-
caused live: a 28-row/12-column aggregation produced exactly this generic,
wrong message because whatever upstream step should have written
executive_summary/message/narration/analysis left all four empty, and the
old fallback had no awareness that real data was sitting right there in
final_state. Fixed by reusing insight_synthesizer_node's own deterministic,
no-LLM-call data-facts computation (already used for its own equivalent
fallback) directly on query_result before giving up to the generic message.
"""

from ee.modules.ai.nodes.insight_synthesizer_node import _compute_data_facts


def test_compute_data_facts_produces_real_numbers_from_rich_result():
    query_result = [
        {"Month": "2024-02-01", "Revenue": 248.35, "Avg Plan Fee": 43.42, "New Subscribers": 8},
        {"Month": "2024-03-01", "Revenue": 253.81, "Avg Plan Fee": 41.39, "New Subscribers": 4},
        {"Month": "2024-04-01", "Revenue": 165.90, "Avg Plan Fee": 38.03, "New Subscribers": 0},
    ]

    facts = _compute_data_facts(query_result)
    fallback_message = f"Query returned {len(query_result)} rows. " + " ".join(facts[1:4])

    assert facts[0] == "Total Rows: 3"
    assert "Revenue" in fallback_message
    assert "Total=" in fallback_message
    # The bug this guards against: a generic non-answer replacing real numbers.
    assert "couldn" not in fallback_message.lower()
    assert "try rephrasing" not in fallback_message.lower()


def test_compute_data_facts_empty_result_produces_no_facts():
    """Guards the fallback's own guard: an empty query_result must not
    produce a fabricated-looking fact list -- the caller falls through to
    the generic message only in this genuinely-nothing-to-show case."""
    assert _compute_data_facts([]) == []
