"""Tests for agentic auto mode resolution in routing_utils."""

import pytest

from ee.modules.ai.utils.routing_utils import (
    infer_analysis_mode_from_query,
    resolve_analysis_mode,
)


@pytest.mark.parametrize(
    "query,expected",
    [
        ("Forecast revenue for the next 6 months", "predictive"),
        ("Why did sales drop last quarter?", "diagnostic"),
        ("What should we do to reduce churn?", "prescriptive"),
        ("Build a sales KPI dashboard with trends", "dashboard"),
        (
            "Why did churn spike and what should we do next?",
            "decision_intelligence",
        ),
        ("How is my business performing?", "business_journey"),
        ("Give me the state of my business this month", "business_journey"),
        ("Can you set up my alerts for revenue drops?", "business_journey"),
        ("I want an OKR review across the org", "business_journey"),
        ("Give me the full picture across all my data sources", "business_journey"),
    ],
)
def test_infer_analysis_mode_from_query(query: str, expected: str) -> None:
    assert infer_analysis_mode_from_query(query) == expected


@pytest.mark.parametrize(
    "query",
    [
        "Export this dashboard as a PowerPoint presentation",
        "download the dashboard showing Q3 revenue as excel",
        "export this dashboard for the board meeting as a pdf",
        "Can you export the dashboard with monthly trends as a word document",
    ],
)
def test_export_format_phrasing_is_not_claimed_by_dashboard_mode(query: str) -> None:
    """Live-reproduced bug: "Export this dashboard as a PowerPoint presentation",
    sent while a dashboard was the sticky chat target, got resolved to
    analysis_mode="dashboard" purely because the dashboard-builder pattern below
    matches "dashboard" + "with/for/showing/including" (or a build/create/generate/
    design verb) anywhere in the sentence - it doesn't distinguish "build a
    dashboard showing X" from "export the dashboard showing X as Y". Resolving to
    "dashboard" here is doubly wrong: supervisor_node.py treats it as a notable,
    explicit mode (goal_resolver._is_notable_mode), which skips Phase -1's agent-
    skill match entirely - so the request never even got a chance to route to the
    export skill and instead built/edited a dashboard, at one point producing a
    hallucinated, unbound widget for a request that was never an edit instruction.
    An explicit export verb ("export"/"download") + file-format word must win over
    the generic "dashboard" keyword match, regardless of how "dashboard" appears in
    the sentence."""
    assert infer_analysis_mode_from_query(query) != "dashboard"


def test_dashboard_pattern_without_export_verb_still_matches():
    """The export-format guard must not swallow genuine dashboard-builder requests
    that merely happen to mention a file-format-sounding word for an unrelated
    reason - only an explicit export/download verb combined with a format word
    should suppress the dashboard match."""
    assert infer_analysis_mode_from_query(
        "Build a dashboard showing revenue, orders, and word count trends"
    ) == "dashboard"


def test_business_journey_phrases_previously_only_in_supervisors_own_keyword_list():
    """These used to live only in supervisor_node.py's now-removed _BJ_STRONG_KEYWORDS
    - a private duplicate of this function's job. Merged here so there's one source
    of truth (per this function's own docstring) and so removing the duplicate list
    didn't quietly drop coverage."""
    for query in (
        "quarterly business review time",
        "let's do a 30 60 90 day plan",
        "need a business health check",
    ):
        assert infer_analysis_mode_from_query(query) == "business_journey"


def test_resolve_auto_to_standard_for_simple_query() -> None:
    mode, at = resolve_analysis_mode(
        "Show monthly revenue by region",
        "auto",
        data_source_id="ds-1",
    )
    assert mode == "standard"
    assert at == "descriptive"


def test_resolve_auto_to_decision_intelligence() -> None:
    mode, at = resolve_analysis_mode(
        "Why did margin fall and what actions should we take?",
        "auto",
        data_source_id="ds-1",
        is_pro=True,
    )
    assert mode == "decision_intelligence"
    assert at == "decision_intelligence"


def test_explicit_mode_not_overridden() -> None:
    mode, at = resolve_analysis_mode(
        "Why did sales drop?",
        "standard",
        data_source_id="ds-1",
    )
    assert mode == "standard"
    assert at == "descriptive"


def test_auto_without_datasource_is_conversational() -> None:
    mode, at = resolve_analysis_mode("Hello", "auto", data_source_id=None)
    assert mode == "conversational"
    assert at == "descriptive"
