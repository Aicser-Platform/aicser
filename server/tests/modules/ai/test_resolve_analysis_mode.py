"""Tests for agentic auto mode resolution in routing_utils."""

import pytest

from src.modules.ai.utils.routing_utils import (
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
    ],
)
def test_infer_analysis_mode_from_query(query: str, expected: str) -> None:
    assert infer_analysis_mode_from_query(query) == expected


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
