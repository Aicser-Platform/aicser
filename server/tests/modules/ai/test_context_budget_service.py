"""Token-budget-aware context assembly: replaces independent fixed caps on
conversation history / KB context / attachment text in the conversational
prompt with one coordinated, priority-ordered allocation - mirrors the
token-budget pattern already proven in schema_optimizer.py."""

import os

import pytest

from ee.modules.ai.services.context_budget_service import ContextCandidate, allocate_context_budget
from ee.modules.ai.nodes.supervisor.conversational import _handle_conversational_mode


class FakeLiteLLM:
    def __init__(self):
        self.prompts: list = []

    async def generate_completion(self, **kwargs):
        self.prompts.append(kwargs.get("prompt"))
        return {"success": True, "content": "An answer.", "model_used": "mock"}


def test_allocator_includes_everything_when_budget_is_generous():
    candidates = [
        ContextCandidate("a", "short text", priority=1),
        ContextCandidate("b", "other short text", priority=2),
    ]
    result = allocate_context_budget(candidates, total_budget_tokens=1000)
    assert "short text" in result
    assert "other short text" in result


def test_allocator_prioritizes_lower_priority_number_first():
    candidates = [
        ContextCandidate("low_priority", "x" * 4000, priority=2),
        ContextCandidate("high_priority", "IMPORTANT" + "y" * 100, priority=1),
    ]
    result = allocate_context_budget(candidates, total_budget_tokens=30)  # ~120 chars
    assert any("IMPORTANT" in r for r in result)
    assert not any("x" * 4000 in r for r in result)


def test_allocator_truncates_the_first_overflowing_candidate_and_drops_the_rest():
    candidates = [
        ContextCandidate("first", "a" * 1000, priority=1),
        ContextCandidate("second", "b" * 1000, priority=2),
    ]
    result = allocate_context_budget(candidates, total_budget_tokens=100)  # ~400 chars
    assert len(result) == 1
    assert result[0].startswith("a")
    assert result[0].endswith("…")


def test_allocator_skips_empty_candidates():
    candidates = [ContextCandidate("empty", "", priority=1), ContextCandidate("real", "content", priority=2)]
    result = allocate_context_budget(candidates, total_budget_tokens=100)
    assert result == ["content"]


def test_allocator_zero_budget_returns_nothing():
    candidates = [ContextCandidate("a", "some text", priority=1)]
    assert allocate_context_budget(candidates, total_budget_tokens=0) == []


@pytest.mark.asyncio
async def test_conversational_history_still_reaches_prompt():
    llm = FakeLiteLLM()
    state = {
        "query": "what did we just discuss?",
        "agent_context": {},
        "conversation_history": [
            {"role": "user", "content": "show me revenue by region"},
            {"role": "assistant", "content": "Revenue was highest in the West region."},
        ],
    }
    await _handle_conversational_mode(state, state["query"], llm)
    assert "Recent conversation" in llm.prompts[0]
    assert "West region" in llm.prompts[0]


@pytest.mark.asyncio
async def test_conversational_attachment_wins_over_history_under_tight_budget(monkeypatch):
    monkeypatch.setenv("AISER_CONVERSATIONAL_CONTEXT_TOKEN_BUDGET", "20")
    llm = FakeLiteLLM()
    state = {
        "query": "what did we discuss and what does the doc say?",
        "agent_context": {},
        "conversation_history": [
            {"role": "user", "content": "a" * 400},
            {"role": "assistant", "content": "b" * 400},
        ],
        "multimodal_context": {"text_excerpt": "IMPORTANT_MARKER " + ("c" * 40)},
    }
    await _handle_conversational_mode(state, state["query"], llm)
    prompt = llm.prompts[0]
    assert "IMPORTANT_MARKER" in prompt
    assert ("a" * 400) not in prompt
