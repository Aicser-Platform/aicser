"""Unit tests for narrative_intent inference (supervisor → insight_synthesizer)."""

from src.modules.ai.utils.narrative_intent import infer_narrative_intent


def test_infer_narrative_intent_chart_explain_precedence():
    assert infer_narrative_intent("Explain this chart") == "chart_explain"
    assert infer_narrative_intent("What does this graph show?") == "chart_explain"
    assert infer_narrative_intent("Walk me through the visualization") == "chart_explain"


def test_infer_narrative_intent_summary():
    assert infer_narrative_intent("Give me an executive summary") == "summary"
    assert infer_narrative_intent("Key takeaways from this data") == "summary"
    assert infer_narrative_intent("TL;DR") == "summary"


def test_infer_narrative_intent_follow_up():
    assert infer_narrative_intent("Why did revenue drop last quarter?") == "follow_up"
    assert infer_narrative_intent("Elaborate on that result") == "follow_up"


def test_infer_narrative_intent_standard_and_empty():
    assert infer_narrative_intent("Show sales by region") == "standard"
    assert infer_narrative_intent("") == "standard"
    assert infer_narrative_intent("  x  ") == "standard"


def test_chart_explain_wins_over_summary_phrases_in_same_string():
    # User asks for both — visual walkthrough should win per docstring precedence
    q = "Executive summary: what does this chart mean?"
    assert infer_narrative_intent(q) == "chart_explain"
