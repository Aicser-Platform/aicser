"""Unit tests for shared LLM timeout / completion-budget policy."""

from ee.modules.ai.utils.llm_call_budget import (
    completion_budget_for,
    headroom_retry_budget,
    looks_like_reasoning_model,
    timeout_for,
)


def test_timeout_scales_with_max_tokens():
    assert timeout_for(100) == 25.0
    assert timeout_for(500) == 45.0
    assert timeout_for(1500) == 60.0
    assert timeout_for(3000) == 90.0
    assert timeout_for(8000, is_local=True) == 180.0


def test_glm_flash_gets_reasoning_headroom():
    assert looks_like_reasoning_model("openrouter/z-ai/glm-5.3-flash")
    budget = completion_budget_for(250, model_id="openrouter/z-ai/glm-5.3-flash")
    assert budget >= 2048
    assert budget >= 250 * 4


def test_standard_chat_model_keeps_visible_budget():
    assert not looks_like_reasoning_model("azure/gpt-4.1-mini", tier="fast")
    assert completion_budget_for(500, model_id="azure/gpt-4.1-mini", tier="fast") == 500


def test_headroom_retry_budget():
    assert headroom_retry_budget(250) >= 2048
    assert headroom_retry_budget(3000, model_cap=8192) == 8192
