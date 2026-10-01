"""Auto mode must route from the question: a default analytics_type ("descriptive") is not a
user choice. Regression: every Auto forecast/diagnosis came back as a plain lookup because the
default looked like an explicit selection (and the LLM then faked a forecast in SQL)."""

import pytest

from ee.modules.ai.orchestrator.initial_state import build_initial_state


def _state(**kw):
    return build_initial_state(litellm_service=None, query="Forecast sales for the next 3 months",
                               conversation_id="c1", user_id="u1", organization_id="o1",
                               data_source_id="d1", **kw)


def test_initial_state_marks_default_vs_explicit_analytics_type():
    auto = _state(analysis_mode="auto")
    assert auto["agent_context"]["analytics_type_explicit"] is False
    assert auto["analytics_type"] == "descriptive"  # safe default still present for any reader
    chosen = _state(analysis_mode="standard", analytics_type="predictive")
    assert chosen["agent_context"]["analytics_type_explicit"] is True


@pytest.mark.asyncio
async def test_sync_entry_leaves_auto_type_unset(monkeypatch):
    from ee.modules.ai.services import analyze_service as A

    seen = {}

    async def fake_run(*args, **kwargs):
        seen["analytics"] = args[8] if len(args) > 8 else kwargs.get("analytics_type")
        return {"success": True}

    monkeypatch.setattr(A, "_run_langgraph_sync", fake_run)
    await A.run_analyze_sync("forecast sales", "d1", None, None, "u1", "o1", analysis_mode="auto")
    assert seen["analytics"] is None
    await A.run_analyze_sync("forecast sales", "d1", None, None, "u1", "o1", analysis_mode="auto",
                             analytics_type="predictive")
    assert seen["analytics"] == "predictive"


def test_ui_auto_placeholder_is_not_a_choice():
    """The chat UI sends analysis_mode=auto with analytics_type=descriptive as a placeholder."""
    ui_auto = _state(analysis_mode="auto", analytics_type="descriptive")
    assert ui_auto["agent_context"]["analytics_type_explicit"] is False
    assert _state(analysis_mode="auto", analytics_type="predictive")["agent_context"]["analytics_type_explicit"] is True
    assert _state(analysis_mode="standard", analytics_type="descriptive")["agent_context"]["analytics_type_explicit"] is True
