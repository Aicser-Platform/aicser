"""Tests for EmbedAssistant/EmbedAssistantShare CRUD schema validation
(server/ee/modules/embed/schemas.py).

Context: system_prompt/welcome_message/fallback_message/conversation_starters
are LLM prompt inputs (system_prompt, conversation_starters) or values
rendered client-side on every page load (welcome_message) -- unbounded input
here is a real cost/abuse surface even though this is a builder feature for
trusted org members, not anonymous input. temperature mirrors litellm's own
accepted range (0-2). EmbedAssistantShare requires exactly one of
shared_with/project_id (a share must name exactly one grant target;
enforced here since the spec calls for a service-layer/schema-layer check,
not a DB constraint -- see models.py's EmbedAssistantShare docstring).
"""
from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError

from ee.modules.embed.schemas import (
    MAX_CONVERSATION_STARTERS,
    MAX_CONVERSATION_STARTER_LEN,
    MAX_FALLBACK_MESSAGE_LEN,
    MAX_SYSTEM_PROMPT_LEN,
    MAX_WELCOME_MESSAGE_LEN,
    EmbedAssistantCreate,
    EmbedAssistantShareCreate,
    EmbedAssistantUpdate,
)


def _create(**overrides) -> EmbedAssistantCreate:
    defaults = dict(name="Bot", organization_id=str(uuid.uuid4()))
    defaults.update(overrides)
    return EmbedAssistantCreate(**defaults)


# ── defaults ─────────────────────────────────────────────────────────────

def test_create_defaults_are_backward_compatible():
    a = _create()
    assert a.visibility == "private"
    assert a.temperature is None
    assert a.conversation_starters == []
    assert a.data_source_ids == []
    assert a.system_prompt is None


# ── temperature bounds (0.0-2.0, litellm's own accepted range) ─────────────

@pytest.mark.parametrize("value", [0.0, 0.7, 1.0, 2.0])
def test_temperature_within_bounds_accepted(value):
    assert _create(temperature=value).temperature == value


@pytest.mark.parametrize("value", [-0.1, 2.1, 5.0])
def test_temperature_outside_bounds_rejected(value):
    with pytest.raises(ValidationError):
        _create(temperature=value)


def test_temperature_none_means_use_system_default():
    assert _create(temperature=None).temperature is None


# ── conversation_starters (capped count + per-item length) ─────────────────

def test_conversation_starters_at_cap_accepted():
    starters = [f"Question {i}" for i in range(MAX_CONVERSATION_STARTERS)]
    assert _create(conversation_starters=starters).conversation_starters == starters


def test_conversation_starters_over_cap_rejected():
    starters = [f"Question {i}" for i in range(MAX_CONVERSATION_STARTERS + 1)]
    with pytest.raises(ValidationError):
        _create(conversation_starters=starters)


def test_conversation_starter_over_length_rejected():
    with pytest.raises(ValidationError):
        _create(conversation_starters=["x" * (MAX_CONVERSATION_STARTER_LEN + 1)])


def test_blank_conversation_starter_rejected():
    with pytest.raises(ValidationError):
        _create(conversation_starters=["   "])


def test_update_conversation_starters_also_validated():
    starters = [f"Question {i}" for i in range(MAX_CONVERSATION_STARTERS + 1)]
    with pytest.raises(ValidationError):
        EmbedAssistantUpdate(conversation_starters=starters)


# ── text max-lengths ─────────────────────────────────────────────────────

def test_system_prompt_at_max_length_accepted():
    assert _create(system_prompt="x" * MAX_SYSTEM_PROMPT_LEN).system_prompt is not None


def test_system_prompt_over_max_length_rejected():
    with pytest.raises(ValidationError):
        _create(system_prompt="x" * (MAX_SYSTEM_PROMPT_LEN + 1))


def test_welcome_message_over_max_length_rejected():
    with pytest.raises(ValidationError):
        _create(welcome_message="x" * (MAX_WELCOME_MESSAGE_LEN + 1))


def test_fallback_message_over_max_length_rejected():
    with pytest.raises(ValidationError):
        _create(fallback_message="x" * (MAX_FALLBACK_MESSAGE_LEN + 1))


# ── visibility enum ──────────────────────────────────────────────────────

@pytest.mark.parametrize("value", ["private", "shared", "public"])
def test_visibility_valid_values_accepted(value):
    assert _create(visibility=value).visibility == value


def test_visibility_invalid_value_rejected():
    with pytest.raises(ValidationError):
        _create(visibility="everyone")


# ── EmbedAssistantShareCreate: exactly one of shared_with/project_id ───────

def test_share_neither_target_rejected():
    with pytest.raises(ValidationError):
        EmbedAssistantShareCreate()


def test_share_both_targets_rejected():
    with pytest.raises(ValidationError):
        EmbedAssistantShareCreate(shared_with=str(uuid.uuid4()), project_id=str(uuid.uuid4()))


def test_share_shared_with_only_accepted():
    s = EmbedAssistantShareCreate(shared_with=str(uuid.uuid4()))
    assert s.shared_with is not None
    assert s.project_id is None


def test_share_project_id_only_accepted():
    s = EmbedAssistantShareCreate(project_id=str(uuid.uuid4()))
    assert s.project_id is not None
    assert s.shared_with is None


def test_share_default_permission_is_use():
    s = EmbedAssistantShareCreate(project_id=str(uuid.uuid4()))
    assert s.permission == "use"
