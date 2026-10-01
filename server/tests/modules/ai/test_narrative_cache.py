"""Narrative reuse: keyed by the exact prompt + who asked (changed data or another user
never hits), bypassed on a front-door 'wants fresh' verdict, and a hit skips the LLM."""

import pytest

from ee.modules.ai.utils import narrative_cache as NC


def test_key_separates_users_prompts_and_can_be_disabled(monkeypatch):
    a = {"organization_id": "o", "user_id": "u1", "data_source_id": "d", "analytics_type": "descriptive"}
    b = dict(a, user_id="u2")
    k = NC.narrative_cache_key("facts: revenue=10", a, "m")
    assert k and k != NC.narrative_cache_key("facts: revenue=10", b, "m")
    assert k != NC.narrative_cache_key("facts: revenue=11", a, "m")  # data changed
    assert k != NC.narrative_cache_key("facts: revenue=10", a, "other-model")
    assert k == NC.narrative_cache_key("facts: revenue=10", dict(a), "m")
    monkeypatch.setenv("AISER_NARRATIVE_CACHE_TTL_S", "0")
    assert NC.narrative_cache_key("facts", a, "m") is None


def _state():
    return {
        "query": "top customers by loan amount",
        "query_result": [{"customer": "Ada", "loan": 69000}, {"customer": "Ben", "loan": 52000}],
        "execution_metadata": {"needs_narrative": True},
        "user_id": "u1", "organization_id": "o1",
    }


CACHED = {
    "executive_summary": "Ada leads with a 69,000 loan, ahead of Ben at 52,000.",
    "insights": [{"title": "Ada leads", "what": "Ada's loan is 69,000, the largest.", "why": "", "so_what": ""}],
    "recommendations": [], "follow_up_questions": [],
}


@pytest.mark.asyncio
async def test_hit_reuses_narrative_without_llm(monkeypatch):
    from ee.modules.ai.nodes.insight_synthesizer_node import insight_synthesizer_node

    monkeypatch.setattr(NC, "narrative_cache_key", lambda *a, **k: "narr:test")
    monkeypatch.setattr(NC, "get_cached_narrative", lambda key: dict(CACHED) if key == "narr:test" else None)
    out = await insight_synthesizer_node(_state(), litellm_service=None)
    assert (out.get("execution_metadata") or {}).get("narrative_cached") is True
    assert "Ada" in (out.get("executive_summary") or "")


@pytest.mark.asyncio
async def test_wants_fresh_bypasses_the_cache(monkeypatch):
    from ee.modules.ai.nodes.insight_synthesizer_node import insight_synthesizer_node

    monkeypatch.setattr(NC, "narrative_cache_key", lambda *a, **k: "narr:test")
    monkeypatch.setattr(NC, "get_cached_narrative", lambda key: dict(CACHED))
    st = _state()
    st["skip_answer_cache"] = True
    out = await insight_synthesizer_node(st, litellm_service=None)
    assert not (out.get("execution_metadata") or {}).get("narrative_cached")
