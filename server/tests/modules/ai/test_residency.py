"""AI residency: provider/host allow-lists enforced at the LLM chokepoint; the hosted
decision model is switched off for orgs that forbid it; no policy = no restriction."""

import pytest

from ee.modules.ai.services import residency as R


def test_violation_rules():
    p = R.normalise_policy({"allowed_providers": ["Azure", "ollama"], "allowed_hosts": ["*.openai.azure.com", "llm.internal"]})
    assert R.violation(p, "azure", "https://eu-prod.openai.azure.com/") is None
    assert R.violation(p, "ollama", "http://llm.internal:11434") is None
    assert "provider 'openrouter'" in R.violation(p, "openrouter", None)
    assert "host 'us.example.com'" in R.violation(p, "azure", "https://us.example.com")
    assert R.violation(None, "openrouter", None) is None
    assert R.normalise_policy({}) is None and R.normalise_policy("x") is None


@pytest.mark.asyncio
async def test_default_policy_for_air_gapped_installs(monkeypatch):
    monkeypatch.setenv("AISER_AI_RESIDENCY_DEFAULT", '{"allowed_providers": ["ollama"], "decision_layer": false}')
    assert (await R.policy_for(None)) == {"allowed_providers": ["ollama"], "decision_layer": False}
    assert await R.decision_layer_allowed(None) is False


@pytest.mark.asyncio
async def test_chokepoint_blocks_disallowed_provider(monkeypatch):
    from ee.modules.ai.services import litellm_service as L

    async def policy(org):
        return {"allowed_providers": ["ollama"]}

    monkeypatch.setattr(R, "policy_for", policy)
    with pytest.raises(R.ResidencyBlocked):
        await L.acompletion(model="openrouter/z-ai/glm-5.3-flash", messages=[{"role": "user", "content": "hi"}], api_key="k")


@pytest.mark.asyncio
async def test_ai_decisions_fall_back_to_llm_when_jev_forbidden(monkeypatch):
    from ee.modules.ai.decisions import backends as B
    from ee.modules.ai.decisions import tool_service as T

    class _Jev(B.DecisionBackend):
        name = "jev"

    monkeypatch.setattr(T, "get_backend", lambda: _Jev())

    async def forbid(org):
        return False

    monkeypatch.setattr(R, "decision_layer_allowed", forbid)
    assert (await T.classifier_for("org-1")).name == "llm"


def test_openai_compatible_servers_are_openai_protocol_and_host_scoped():
    from ee.modules.ai.services import litellm_service as L

    kw = {"model": "openai/Qwen/Qwen3-32B-Instruct", "api_key": "local-key", "api_base": "http://vllm.internal:8000/v1"}
    assert L._infer_provider_from_kwargs(kw) == "openai"
    p = R.normalise_policy({"allowed_providers": ["openai"], "allowed_hosts": ["vllm.internal"]})
    assert R.violation(p, "openai", kw["api_base"]) is None
    assert R.violation(p, "openai", "https://api.openai.com/v1") is not None  # real OpenAI refused
