"""Tests for adaptive continuation action mapping."""

from unittest.mock import AsyncMock

import pytest

from ee.modules.ai.services.adaptive_continuation_service import (
    _prompt_to_continuation_action,
    apply_continuation,
    enrich_with_schema_aware_followups,
)


def test_prompt_to_decision_intelligence_mode() -> None:
    action = _prompt_to_continuation_action(
        "What should we decide next?",
        default_mode="auto",
    )
    assert action["analysis_mode"] == "decision_intelligence"
    assert action["type"] == "analytics"
    assert action.get("reuse_last_result") is True


def test_prompt_to_dashboard_mode() -> None:
    action = _prompt_to_continuation_action(
        "Build a dashboard from this analysis",
        default_mode="auto",
    )
    assert action["analysis_mode"] == "dashboard"
    assert action["type"] == "analytics"


def test_alert_chip_uses_skill_not_business_os() -> None:
    action = _prompt_to_continuation_action(
        "Create an alert to monitor this metric",
        default_mode="diagnostic",
    )
    assert action["type"] == "alert"
    assert action["requested_skill"] == "create_alert"
    assert action["reuse_last_result"] is True
    assert action["analysis_mode"] != "business_journey"


def test_apply_continuation_sets_metadata() -> None:
    state = {
        "analytics_type": "diagnostic",
        "query_result": [{"x": 1}],
        "insights": [{"title": "Drop in sales"}],
        "follow_up_questions": [],
    }
    apply_continuation(state)
    assert state.get("continuation_actions")
    assert len(state["continuation_actions"]) >= 1
    meta = state.get("execution_metadata") or {}
    assert meta.get("continuation_actions")


def test_dashboard_followups_are_grounded_in_real_widget_names() -> None:
    # Root cause this guards: the dashboard branch used to be the one
    # exception to every other journey-phase branch (assess/strategy/plan),
    # which substitute real opportunity/risk/KPI names — it emitted the same
    # 4 generic strings ("Add a KPI widget...") no matter what the dashboard
    # actually contained.
    state = {
        "current_stage": "dashboard_generation_complete",
        "dashboard_created": {
            "dashboard_id": "dash-123",
            "widget_count": 2,
            "widgets": [
                {"name": "Monthly Revenue by Region", "chart_type": "line"},
                {"name": "Churn Rate", "chart_type": "stat"},
            ],
        },
        "follow_up_questions": [],
    }
    apply_continuation(state)
    joined = " ".join(state["follow_up_questions"])
    assert "Monthly Revenue by Region" in joined
    assert "Churn Rate" in joined
    assert "Add a KPI widget to this dashboard" not in state["follow_up_questions"]


def test_dashboard_followups_fall_back_gracefully_without_widget_names() -> None:
    state = {
        "current_stage": "dashboard_generation_complete",
        "dashboard_created": {"dashboard_id": "dash-456", "widget_count": 1, "widgets": []},
        "follow_up_questions": [],
    }
    apply_continuation(state)
    assert len(state["follow_up_questions"]) == 4
    assert all(isinstance(s, str) and s for s in state["follow_up_questions"])


_REPORT_SCHEMA = {
    "tables": [
        {"name": "sales", "columns": [{"name": "revenue", "type": "numeric"}, {"name": "region", "type": "varchar"}]}
    ]
}


@pytest.mark.asyncio
async def test_executive_report_gets_llm_grounded_followups_from_report_sections(monkeypatch) -> None:
    # Root cause this guards: executive reports have no single flat
    # query_result (each section runs its own SQL — see
    # executive_report_execution_node.py), so this enrichment used to always
    # bail out at the query_result check and report mode was permanently
    # stuck on apply_continuation()'s generic templates, unlike every other
    # analytics_type which gets real LLM-grounded questions.
    captured = {}

    async def fake_discovery(self, **kwargs):
        captured.update(kwargs)
        return ["Deep dive into the regional revenue swing?"]

    monkeypatch.setattr(
        "ee.modules.ai.utils.question_discovery.QuestionDiscoveryService.generate_smart_discovery_with_llm",
        fake_discovery,
    )
    monkeypatch.setattr(
        "ee.modules.ai.services.litellm_service.LiteLLMService.hydrate_user_byok_models",
        AsyncMock(return_value=None),
    )

    state = {
        "current_stage": "report_execution_complete",
        "analytics_type": "executive_report",
        "data_source_schema": _REPORT_SCHEMA,
        "report_sections": [
            {
                "title": "Regional Revenue",
                "status": "complete",
                "narrative": "Revenue swung sharply between regions this quarter.",
                "key_metric": "Total Revenue",
                "key_metric_value": "$1.2M",
            },
            {"title": "Failed Section", "status": "failed", "error": "timeout"},
        ],
        "follow_up_questions": [],
        "user_id": "u1",
        "organization_id": "org-1",
    }

    await enrich_with_schema_aware_followups(state)

    assert "Deep dive into the regional revenue swing?" in state["follow_up_questions"]
    assert captured["mode"] == "executive_report"
    assert captured["query_result"] is None
    assert captured["insights"] == [
        {"title": "Regional Revenue", "description": "Total Revenue: $1.2M. Revenue swung sharply between regions this quarter."}
    ]


@pytest.mark.asyncio
async def test_executive_report_without_usable_sections_does_not_call_llm(monkeypatch) -> None:
    fake_discovery = AsyncMock()
    monkeypatch.setattr(
        "ee.modules.ai.utils.question_discovery.QuestionDiscoveryService.generate_smart_discovery_with_llm",
        fake_discovery,
    )

    state = {
        "current_stage": "report_execution_complete",
        "analytics_type": "executive_report",
        "data_source_schema": _REPORT_SCHEMA,
        "report_sections": [{"title": "Failed Section", "status": "failed", "error": "timeout"}],
        "follow_up_questions": [],
    }

    await enrich_with_schema_aware_followups(state)

    fake_discovery.assert_not_called()
    assert state["follow_up_questions"] == []
