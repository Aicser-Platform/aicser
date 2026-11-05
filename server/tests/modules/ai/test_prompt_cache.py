"""Prompt caching: explicit breakpoints only where providers need them, cached tokens priced."""

from ee.modules.ai.services import litellm_service as L

LONG = "x" * 4000


def test_implicit_cache_providers_get_messages_unchanged():
    msgs = [{"role": "system", "content": LONG}, {"role": "user", "content": "q"}]
    assert L._apply_prompt_cache(msgs, "openrouter/z-ai/glm-5.3-flash") is msgs


def test_explicit_providers_get_system_and_history_breakpoints():
    msgs = [{"role": "system", "content": LONG}, {"role": "user", "content": LONG},
            {"role": "assistant", "content": "a"}, {"role": "user", "content": "next"}]
    out = L._apply_prompt_cache(msgs, "openrouter/anthropic/claude-sonnet-5.5")
    assert out[0]["content"][0]["cache_control"] == {"type": "ephemeral"}
    assert out[2]["content"][0]["cache_control"] == {"type": "ephemeral"}
    assert out[3] == msgs[3] and isinstance(msgs[0]["content"], str)  # original untouched


def test_short_prompts_are_not_marked(monkeypatch):
    msgs = [{"role": "system", "content": "short"}, {"role": "user", "content": "q"}]
    assert L._apply_prompt_cache(msgs, "gemini/gemini-2.5-flash") == msgs


def test_cache_can_be_turned_off(monkeypatch):
    monkeypatch.setenv("AISER_PROMPT_CACHE", "false")
    msgs = [{"role": "system", "content": LONG}, {"role": "user", "content": "q"}]
    assert L._apply_prompt_cache(msgs, "anthropic/claude") is msgs


def test_cached_tokens_read_from_openai_and_anthropic_usage():
    assert L._usage_cached_tokens({"prompt_tokens_details": {"cached_tokens": 900}}) == 900
    assert L._usage_cached_tokens({"cache_read_input_tokens": 300}) == 300
    assert L._usage_cached_tokens(None) == 0


def test_routed_models_have_prices():
    cat = L.get_llm_pricing_catalog()
    assert cat["glm-5.3-flash"]["input"] == 0.00015 and "deepseek-v4-flash" in cat
