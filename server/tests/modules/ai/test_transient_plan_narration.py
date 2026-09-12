"""Tests for graph_state.is_transient_plan_narration.

Context: response_finalizer_node.py's "every completed turn ships user-facing
prose" fallback chain used to accept state["message"]/state["narration"] at
face value whenever state["executive_summary"] was empty. advance_plan_step
sets narration to one of exactly two transient progress-status templates on
every step transition -- including the "visualize" step's own
advance_plan_step call inside response_finalizer_node itself, a few lines
before that fallback chain runs. Reported live: an Analyze-mode response
whose entire visible content was "Next, I am planning execution." -- the
literal advance_plan_step template, shipped to the user as if it were the
actual answer, because executive_summary happened to be empty at that point
(LLM failure with no data_facts to fall back to).
"""

from ee.modules.ai.schemas.graph_state import advance_plan_step, is_transient_plan_narration


def test_matches_the_next_step_template_that_leaked_live():
    assert is_transient_plan_narration("Next, I am planning execution.") is True


def test_matches_the_active_step_template():
    assert is_transient_plan_narration("I am now generating sql...") is True


def test_does_not_reject_a_genuine_answer_that_happens_to_mention_next_steps():
    """A real LLM-generated insight discussing what to do next is legitimate
    content -- only the EXACT two advance_plan_step templates (prefix AND
    suffix) should be rejected, not anything that merely starts with similar
    words."""
    genuine = (
        "Next, I am seeing a 12% increase in revenue driven primarily by the "
        "enterprise segment, which grew from $1.2M to $1.4M this quarter."
    )
    assert is_transient_plan_narration(genuine) is False


def test_does_not_reject_a_normal_insight_with_no_special_phrasing():
    assert is_transient_plan_narration(
        "Revenue grew 12% quarter over quarter, driven by the enterprise segment."
    ) is False


def test_empty_and_none_are_not_transient():
    assert is_transient_plan_narration("") is False
    assert is_transient_plan_narration(None) is False
    assert is_transient_plan_narration("   ") is False


def test_whitespace_padded_placeholder_still_matches():
    assert is_transient_plan_narration("  Next, I am planning execution.  ") is True


def test_length_cap_prevents_rejecting_a_short_but_substantive_genuine_answer():
    """Prefix+suffix matching alone is not precise enough: a real, short
    insight can legitimately open with "Next, I am" and close with a period.
    advance_plan_step's {label} is always a short step-label echo, never a
    real sentence, so the length cap is what actually distinguishes the two --
    this is the exact case that motivated adding it (an earlier version of
    this function rejected a genuine answer shaped like this)."""
    genuine_but_short_prefix_collision = (
        "Next, I am seeing a 12% increase in revenue driven primarily by the "
        "enterprise segment, which grew from $1.2M to $1.4M this quarter."
    )
    assert len(genuine_but_short_prefix_collision) > 80
    assert is_transient_plan_narration(genuine_but_short_prefix_collision) is False


def test_advance_plan_step_uses_label_not_step_fraction():
    state = {
        "execution_plan": [
            {"id": "execute", "label": "Retrieving data", "status": "active"},
            {"id": "quality", "label": "Validating data for forecasting", "status": "pending"},
        ]
    }
    advance_plan_step(state, "execute", status="complete")
    msg = str(state.get("progress_message") or "")
    assert "Step " not in msg
    assert "Validating data for forecasting" in msg
