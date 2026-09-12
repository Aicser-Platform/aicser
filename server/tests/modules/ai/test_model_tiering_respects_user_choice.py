"""Regression tests: an explicit user model selection must actually reach
internal LLM calls (routing confirmation, skill selection, plan
decomposition), not get silently discarded in favor of tier-based
auto-routing.

Root cause: resolve_model_for_node()'s docstring already named its third
parameter `user_model`, but (1) its own priority order checked env
overrides and tier-based auto-routing (get_model_for_tier) BEFORE ever
consulting user_model, so even a caller that passed it through would still
have it silently overridden; and (2) the three real call sites
(kernel/planner.py's _llm_decompose_steps, skill_executor_node.py's
_llm_select_skills[_checked], routing_utils.py's check_notable_mode_confidence)
all hardcoded None for it anyway, never reading the user's actual selection
from state["model_id"] at all.

Live-reproduced: a user selected a self-hosted Ollama model, sent "hi", and
the server logs showed "Tool-calling completion failed ... model=openai/
qwen3.8-27b" — the platform's cloud default, not the model they picked. For
a local/self-hosted selection specifically, silently calling out to a cloud
model instead defeats the entire reason to pick local in the first place.

Fixed to match the already-established rule in resolve_working_model_id
(see its own docstring: "an explicit model_id ... is the user's intentional
choice, not the system picking for them" — fixed once already for the main
completion path after being reported live as "I selected a specific AI
model but it still uses the default", never propagated to this parallel
node-tiering path until now): an explicit user_model now wins over env/tier
auto-routing, with one narrow exception preserved — a retry step's
escalation-to-strong after a verification failure still overrides even an
explicit pick, since retrying with the exact model/config that just failed
rarely helps.
"""

from unittest.mock import patch

from ee.modules.ai.services.model_tiering import insight_tier_for_state, resolve_model_for_node


class _FakeLiteLLM:
    """Simulates tier-based auto-routing always having an answer, so tests
    can tell "explicit choice won" apart from "nothing else resolved either"."""

    def get_model_for_tier(self, tier):
        return f"auto_{tier}_model"


def test_explicit_user_model_wins_over_tier_auto_routing_on_a_fast_node():
    resolved = resolve_model_for_node("skill_executor", _FakeLiteLLM(), "byok_ollama_qwen")
    assert resolved == "byok_ollama_qwen"


def test_explicit_user_model_wins_over_tier_auto_routing_on_a_strong_node():
    resolved = resolve_model_for_node("nl2sql", _FakeLiteLLM(), "byok_ollama_qwen")
    assert resolved == "byok_ollama_qwen"


def test_explicit_user_model_wins_even_over_env_overrides():
    with patch.dict("os.environ", {"AISER_FAST_MODEL": "env_fast_override"}):
        resolved = resolve_model_for_node("skill_executor", _FakeLiteLLM(), "byok_ollama_qwen")
    assert resolved == "byok_ollama_qwen"


def test_auto_or_unset_still_falls_through_to_tier_routing():
    for sentinel in (None, "", "auto", "AUTO", "none", "default"):
        resolved = resolve_model_for_node("skill_executor", _FakeLiteLLM(), sentinel)
        assert resolved == "auto_fast_model", sentinel


def test_retry_escalation_still_overrides_an_explicit_choice():
    """The one deliberate exception: a retry-after-verification-failure step
    escalated to "strong" must not just retry the same model that already
    failed, even if the user had explicitly picked it."""
    with patch(
        "ee.modules.ai.utils.escalation_context.is_reasoning_escalated",
        return_value=True,
    ):
        resolved = resolve_model_for_node("skill_executor", _FakeLiteLLM(), "byok_ollama_qwen")
    assert resolved == "auto_reasoning_model"


def test_no_litellm_service_and_no_user_model_returns_none():
    assert resolve_model_for_node("skill_executor", None, None) is None


def test_insight_tier_simple_descriptive_is_fast():
    assert insight_tier_for_state({
        "analytics_type": "descriptive",
        "query_intent": {"query_complexity": "simple"},
        "execution_metadata": {"analysis_mode": "standard"},
    }) == "fast"


def test_insight_tier_diagnostic_forecast_complex_is_fast_first():
    """Strong is the retry upgrade in insight_synthesizer_node, not attempt 0."""
    assert insight_tier_for_state({
        "analytics_type": "descriptive",
        "query_intent": {"query_complexity": "complex"},
    }) == "fast"
    assert insight_tier_for_state({"analytics_type": "predictive"}) == "fast"
    assert insight_tier_for_state({"analytics_type": "diagnostic"}) == "fast"


def test_tier_override_fast_beats_insight_node_default():
    resolved = resolve_model_for_node(
        "insight_synthesizer", _FakeLiteLLM(), None, tier_override="fast"
    )
    assert resolved == "auto_fast_model"
