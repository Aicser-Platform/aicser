"""Tests for insight_synthesizer_node.py's data_facts_fallback insight cards.

Context: when the LLM call fails outright, or returns unusable/empty content
even after the retry-loop fix, the fallback path used to discard every
computed data fact but one into a single flat summary sentence, leaving
`insights` completely empty -- reported live as "even using summary
statistics it shall write meaningful insights". _compute_data_facts already
computes several genuine, deterministic facts (row count, per-column
total/avg/min/max, top categorical value + share, time range); this was pure
information loss, not a quality ceiling actually imposed by having no LLM
available for that request.
"""

from ee.modules.ai.nodes.insight_synthesizer_node import _build_fallback_insights_from_facts


def test_each_fact_becomes_its_own_insight_card_not_a_single_flat_sentence():
    facts = [
        "Total Rows: 1234",
        "revenue: Total=45,231.00, Avg=36.67, Min=1.00, Max=999.00",
        "Top category: 'Electronics' (412 rows, 33.4%)",
        "Time Range: 2025-01-01 to 2025-12-31",
    ]

    cards = _build_fallback_insights_from_facts(facts)

    assert len(cards) == 4
    assert cards[0]["title"] == "Total Rows"
    assert cards[0]["what"] == "1234"
    assert cards[1]["title"] == "revenue"
    assert "Avg=36.67" in cards[1]["what"]


def test_every_card_has_the_shape_insight_synthesizer_validation_requires():
    """The parser downstream (insight_synthesizer_node.py's own validation loop)
    only keeps an insight dict when it has a non-empty title AND non-empty
    what/description -- a fallback card that doesn't satisfy this would be
    silently dropped again, reproducing the original empty-insights bug one
    layer down."""
    cards = _build_fallback_insights_from_facts(["Total Rows: 42"])

    card = cards[0]
    assert card["title"].strip()
    assert card["what"].strip()
    assert card["type"] == "finding"
    assert card["confidence"] == 1.0


def test_confidence_is_maximal_not_the_uncertain_llm_default():
    """These are exact computed values, not an LLM's approximation -- they
    should read as more trustworthy than a genuine LLM-generated insight
    (which defaults to confidence=0.7 elsewhere in this file), not less."""
    cards = _build_fallback_insights_from_facts(["Total Rows: 1"])
    assert cards[0]["confidence"] == 1.0


def test_never_invents_so_what_or_now_what_interpretation():
    """_compute_data_facts' own docstring calls these facts "AUTHORITATIVE"
    precisely because they don't editorialize -- the fallback must not start
    inventing an interpretation the data doesn't actually support."""
    cards = _build_fallback_insights_from_facts(["revenue: Total=100.00"])
    assert cards[0]["so_what"] == ""
    assert cards[0]["now_what"] == ""


def test_fact_with_no_colon_still_produces_a_valid_card():
    cards = _build_fallback_insights_from_facts(["No data available"])
    assert len(cards) == 1
    assert cards[0]["title"] == "Data Fact"
    assert cards[0]["what"] == "No data available"


def test_empty_facts_list_produces_no_cards():
    assert _build_fallback_insights_from_facts([]) == []
