"""Regression tests: several pipeline nodes read the user's selected model
from the wrong state field and always got None back.

Root cause, found while auditing every mode for enterprise-quality
correctness: eight call sites across five files (dashboard_lifecycle_node.py
x2, insight_synthesizer_node.py, business_journey_nodes.py x3,
dashboard_pesd_nodes.py x2 — decision_intelligence_node.py makes a ninth,
found first and used as the template for this fix) all read
`agent_context["model_id"]`, via the identical pattern
`agent_ctx.get("model_id") if isinstance(agent_ctx, dict) else None`. A
repo-wide search confirmed agent_context["model_id"] is never set anywhere
in the codebase — the real user-selected model lives at state["model_id"]
(see ee/modules/ai/orchestrator/initial_state.py, which does
`state["model_id"] = model`). Every one of these nine call sites therefore
always silently resolved to None regardless of what model the user picked,
falling through to whatever the platform default happened to be — the same
class of "explicit choice ignored" bug already found and fixed this session
in skill-selection/plan-decomposition/mode-confirmation, just in a
different, much larger set of pipelines (dashboard generation, dashboard
editing, business journey, decision intelligence, insight synthesis).

This file directly tests decision_intelligence_node (simplest to isolate)
as the representative case; the other eight sites use the byte-identical
fix (state.get("model_id") in place of the broken agent_context read),
confirmed via a repo-wide grep showing zero remaining occurrences of the
broken pattern.
"""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.nodes.decision_intelligence_node import decision_intelligence_node


def _base_state(**overrides) -> dict:
    state = {
        "query": "what should we do about declining scores?",
        "user_id": "u1",
        "organization_id": "org1",
        "analytics_metadata": {},
        "query_result": [],
        "data_source_schema": {"name": "Education"},
        "agent_context": {"model_id": "wrong-value-from-agent-context"},
        "model_id": "byok_ollama_qwen",
    }
    state.update(overrides)
    return state


@pytest.mark.asyncio
async def test_decision_intelligence_uses_state_model_id_not_agent_context():
    captured = {}

    class _FakeSynthesizer:
        async def synthesize_tactical(self, **kwargs):
            captured.update(kwargs)
            return {"summary": "ok"}

    with patch(
        "ee.modules.ai.nodes.decision_intelligence_node.DecisionSynthesizer",
        return_value=_FakeSynthesizer(),
    ), patch(
        "ee.modules.ai.nodes.decision_intelligence_node.apply_brief_to_state",
        new=lambda state, brief: None,
    ), patch(
        "ee.modules.ai.utils.user_preference_store.get_role_tone_instruction",
        return_value="",
    ):
        await decision_intelligence_node(_base_state(), litellm_service=AsyncMock())

    assert captured.get("model_id") == "byok_ollama_qwen"


@pytest.mark.asyncio
async def test_decision_intelligence_falls_back_to_none_when_nothing_selected():
    """Control case: no explicit selection (auto) must still resolve to None,
    not crash or pick up a stray agent_context value."""
    captured = {}

    class _FakeSynthesizer:
        async def synthesize_tactical(self, **kwargs):
            captured.update(kwargs)
            return {"summary": "ok"}

    state = _base_state(model_id=None, agent_context={})
    with patch(
        "ee.modules.ai.nodes.decision_intelligence_node.DecisionSynthesizer",
        return_value=_FakeSynthesizer(),
    ), patch(
        "ee.modules.ai.nodes.decision_intelligence_node.apply_brief_to_state",
        new=lambda state, brief: None,
    ), patch(
        "ee.modules.ai.utils.user_preference_store.get_role_tone_instruction",
        return_value="",
    ):
        await decision_intelligence_node(state, litellm_service=AsyncMock())

    assert captured.get("model_id") is None


def test_no_remaining_agent_context_model_id_reads():
    """Guards against regression: greps the actual source tree for the
    broken pattern this whole test file exists to fix, across the nine
    confirmed call sites (and any future copy-paste of the same mistake)."""
    import pathlib
    import re

    ee_root = pathlib.Path(__file__).resolve().parents[3] / "ee"
    broken_pattern = re.compile(r'agent_ctx(?:_dict)?\.get\(["\']model_id["\']\)')
    offenders = []
    for path in ee_root.rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if broken_pattern.search(text):
            offenders.append(str(path))
    assert offenders == []
