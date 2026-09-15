"""role_persona is an explicit user choice ("talk to me like an executive/
analyst/manager") - unlike the rest of user_preference_store, which only
learns from behavior after 2+ interactions. Wired into Decision Intelligence
and Business OS narrative synthesis so the same underlying analysis can read
differently for a CFO than for a data analyst, addressing the audit finding
that generated content reads identically regardless of who's asking."""

from unittest.mock import patch

import pytest

from ee.modules.ai.utils.user_preference_store import (
    ROLE_PERSONAS,
    format_preference_hint,
    get_preferences,
    get_role_tone_instruction,
    set_role_persona,
)


@pytest.fixture(autouse=True)
def _no_redis():
    # Force the in-memory fallback path so tests don't depend on a real Redis.
    with patch("ee.modules.ai.utils.user_preference_store._get_redis", return_value=None):
        yield


def test_set_role_persona_rejects_unknown_value():
    assert set_role_persona("user-1", "wizard") is False
    assert get_preferences("user-1").get("role_persona") is None


def test_set_role_persona_persists_and_is_readable():
    assert set_role_persona("user-2", "executive") is True
    assert get_preferences("user-2")["role_persona"] == "executive"


def test_get_role_tone_instruction_returns_persona_specific_text():
    set_role_persona("user-3", "analyst")
    instruction = get_role_tone_instruction("user-3")
    assert "methodology" in instruction.lower()

    set_role_persona("user-3", "executive")
    instruction = get_role_tone_instruction("user-3")
    assert "bottom-line" in instruction.lower() or "decision" in instruction.lower()


def test_get_role_tone_instruction_empty_for_general_or_unset():
    assert get_role_tone_instruction("user-never-set") == ""
    set_role_persona("user-4", "general")
    assert get_role_tone_instruction("user-4") == ""


def test_format_preference_hint_surfaces_persona_even_with_no_learned_history():
    # Regression: format_preference_hint used to require 2+ interactions before
    # returning anything at all - an explicit persona choice must apply
    # immediately, not wait for the user to be "profiled" first.
    set_role_persona("user-5", "manager")
    hint = format_preference_hint("user-5")
    assert "manager" in hint.lower()


def test_role_personas_are_scoped_per_organization():
    set_role_persona("user-6", "executive", organization_id="org-a")
    set_role_persona("user-6", "analyst", organization_id="org-b")
    assert get_preferences("user-6", "org-a")["role_persona"] == "executive"
    assert get_preferences("user-6", "org-b")["role_persona"] == "analyst"


def test_all_declared_personas_have_an_instruction_entry():
    for persona in ROLE_PERSONAS:
        set_role_persona("user-7", persona)
        # Must not raise, and "general" is allowed to be the empty string.
        instruction = get_role_tone_instruction("user-7")
        assert isinstance(instruction, str)
