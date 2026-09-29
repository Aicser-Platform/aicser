"""OpenRouter router-side resilience: server-side model fallbacks and provider routing are
added only for OpenRouter models, never override caller choices, and health checks test
exactly the model they name."""

from ee.modules.ai.services import litellm_service as L


def _p(model="openrouter/z-ai/glm-5.3-flash", **kw):
    return {"model": model, "messages": [], **kw}


def test_fallback_models_listed_primary_first(monkeypatch):
    monkeypatch.setenv("OPENROUTER_FALLBACK_MODELS", "deepseek/deepseek-v3.2, openrouter/z-ai/glm-5.3-flash,openai/gpt-4.1-mini")
    out = L.apply_openrouter_routing(_p())
    assert out["extra_body"]["models"] == ["z-ai/glm-5.3-flash", "deepseek/deepseek-v3.2", "openai/gpt-4.1-mini"]


def test_no_env_no_change_and_other_providers_untouched(monkeypatch):
    for k in ("OPENROUTER_FALLBACK_MODELS", "OPENROUTER_PROVIDER_SORT", "OPENROUTER_DATA_COLLECTION", "OPENROUTER_ZDR"):
        monkeypatch.delenv(k, raising=False)
    assert "extra_body" not in L.apply_openrouter_routing(_p())
    monkeypatch.setenv("OPENROUTER_FALLBACK_MODELS", "deepseek/deepseek-v3.2")
    assert "extra_body" not in L.apply_openrouter_routing(_p(model="azure/gpt-4.1-mini"))


def test_provider_preferences_and_privacy(monkeypatch):
    monkeypatch.delenv("OPENROUTER_FALLBACK_MODELS", raising=False)
    monkeypatch.setenv("OPENROUTER_PROVIDER_SORT", "latency")
    monkeypatch.setenv("OPENROUTER_DATA_COLLECTION", "deny")
    monkeypatch.setenv("OPENROUTER_ZDR", "true")
    prov = L.apply_openrouter_routing(_p())["extra_body"]["provider"]
    assert prov == {"sort": "latency", "data_collection": "deny", "zdr": True, "allow_fallbacks": True}


def test_caller_choices_win(monkeypatch):
    monkeypatch.setenv("OPENROUTER_FALLBACK_MODELS", "deepseek/deepseek-v3.2")
    monkeypatch.setenv("OPENROUTER_PROVIDER_SORT", "latency")
    out = L.apply_openrouter_routing(_p(extra_body={"models": ["x/y"], "provider": {"sort": "price"}}))
    assert out["extra_body"]["models"] == ["x/y"]
    assert out["extra_body"]["provider"]["sort"] == "price"


def test_health_check_tests_the_exact_model(monkeypatch):
    monkeypatch.setenv("OPENROUTER_FALLBACK_MODELS", "deepseek/deepseek-v3.2")
    monkeypatch.delenv("OPENROUTER_PROVIDER_SORT", raising=False)
    monkeypatch.delenv("OPENROUTER_DATA_COLLECTION", raising=False)
    monkeypatch.delenv("OPENROUTER_ZDR", raising=False)
    assert "extra_body" not in L.apply_openrouter_routing(_p(), exact_model=True)


def test_openrouter_has_its_own_concurrency_lane():
    assert L._infer_provider_from_kwargs({"model": "openrouter/z-ai/glm-5.3-flash", "api_key": "sk-or-v1-abc"}) == "openrouter"
    assert "openrouter" in L._PROVIDER_SEMAPHORES


def test_small_calls_ask_thinking_models_for_low_effort(monkeypatch):
    for k in ("OPENROUTER_FALLBACK_MODELS", "OPENROUTER_PROVIDER_SORT", "OPENROUTER_DATA_COLLECTION", "OPENROUTER_ZDR",
              "AISER_OPENROUTER_SMALL_CALL_REASONING"):
        monkeypatch.delenv(k, raising=False)
    assert L.apply_openrouter_routing(_p(max_tokens=2048))["extra_body"]["reasoning"] == {"effort": "low"}
    assert "extra_body" not in L.apply_openrouter_routing(_p(max_tokens=16384))  # big generation: provider default
    explicit = L.apply_openrouter_routing(_p(max_tokens=512, extra_body={"reasoning": {"effort": "high"}}))
    assert explicit["extra_body"]["reasoning"] == {"effort": "high"}
    monkeypatch.setenv("AISER_OPENROUTER_SMALL_CALL_REASONING", "off")
    assert "extra_body" not in L.apply_openrouter_routing(_p(max_tokens=512))
