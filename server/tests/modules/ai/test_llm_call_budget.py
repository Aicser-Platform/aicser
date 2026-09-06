"""Tests for the shared LLM call timeout policy that replaced hand-picked
per-call-site constants (timeout=45.0, timeout=35.0, ...) added earlier in
this session's executive-report fixes. See llm_call_budget.py's docstring
for the root cause this consolidation closes: a single flat 25s default
applied to every call regardless of expected output size, and per-call
hardcoded overrides that a new call site could easily forget to add.
"""

import pytest

from ee.modules.ai.utils.llm_call_budget import timeout_for


def test_small_cloud_call_gets_the_original_25s_default():
    assert timeout_for(150, is_local=False) == 25.0


def test_report_section_narrative_sized_call_gets_45s():
    """Matches the exact value hand-picked and live-verified this session
    for the ~600-token per-section narrative call."""
    assert timeout_for(600, is_local=False) == 45.0


def test_larger_report_planning_call_gets_a_bigger_budget_than_the_old_hardcode():
    """4000-token report planning was hardcoded to 45.0 earlier this
    session — the shared policy now gives it more room since it's a
    genuinely bigger ask than the 600-token narrative call."""
    assert timeout_for(4000, is_local=False) > 45.0


def test_local_model_always_gets_more_time_than_cloud_for_the_same_task():
    for tokens in (150, 600, 1500, 4000):
        assert timeout_for(tokens, is_local=True) > timeout_for(tokens, is_local=False)


def test_local_small_call_floor_matches_existing_ollama_default():
    assert timeout_for(150, is_local=True) == 60.0


@pytest.mark.parametrize("tokens", [0, -5, None])
def test_degenerate_max_tokens_does_not_crash(tokens):
    assert timeout_for(tokens, is_local=False) == 25.0


def test_timeout_never_decreases_as_max_tokens_grows():
    """A monotonicity sanity check — more requested output should never
    result in a shorter budget, for either cloud or local."""
    tokens_sequence = [50, 200, 600, 1000, 1500, 2000, 3000, 8000]
    for is_local in (False, True):
        values = [timeout_for(t, is_local=is_local) for t in tokens_sequence]
        assert values == sorted(values)
