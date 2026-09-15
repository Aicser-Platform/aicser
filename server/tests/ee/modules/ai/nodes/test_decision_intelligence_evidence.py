"""Decide mode must not invent a complete Decision Brief from descriptive stats."""

import pytest

from ee.modules.ai.nodes.decision_intelligence_node import decision_intelligence_node


@pytest.mark.asyncio
async def test_decision_intelligence_refuses_thin_brief_without_depth_evidence():
    state = {
        "query": "Should we expand this product?",
        "analytics_metadata": {},
        "query_result": [{"revenue": 100}],
        "data_source_schema": {"name": "sales"},
        "execution_metadata": {},
    }
    out = await decision_intelligence_node(state, litellm_service=None)
    assert out.get("mode_degraded") is True
    assert out.get("mode_degraded_to") == "descriptive"
    assert out.get("decision_brief") is None
    summary = str(out.get("executive_summary") or "")
    assert "Decision Brief was not produced" in summary
    insights = out.get("insights") or []
    assert insights
    assert "evidence" in str(insights[0].get("title") or "").lower() or "evidence" in str(
        insights[0].get("what") or ""
    ).lower()


@pytest.mark.asyncio
async def test_decision_intelligence_synthesizes_when_diagnostic_evidence_exists(monkeypatch):
    captured = {}

    async def fake_synthesize(self, **kwargs):
        captured.update(kwargs)
        return {
            "executive_decision": "Keep the current mix.",
            "options": [{"label": "Hold", "recommended": True, "description": "Hold"}],
            "recommended_actions": [{"action": "Monitor mix"}],
            "kpis_to_monitor": ["revenue"],
            "decision_confidence": "medium",
        }

    monkeypatch.setattr(
        "ee.modules.ai.nodes.decision_intelligence_node.DecisionSynthesizer.synthesize_tactical",
        fake_synthesize,
    )

    state = {
        "query": "Should we expand?",
        "analytics_metadata": {"diagnostic": {"top_contributors": [{"factor": "region"}]}},
        "query_result": [{"revenue": 100}],
        "data_source_schema": {"name": "sales"},
        "execution_metadata": {},
    }
    out = await decision_intelligence_node(state, litellm_service=object())
    assert captured
    assert out.get("decision_brief")
    assert out.get("mode_degraded") is not True
