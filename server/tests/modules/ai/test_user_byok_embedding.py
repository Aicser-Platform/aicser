"""Tests for ee/modules/ai/services/user_byok_embedding.py -- org-shared BYOK
embedding config resolution.

Context: embedding_service.py used to be entirely platform-wide
(EMBEDDING_PROVIDER env var, no per-tenant awareness at all), while chat
completions already had full per-user/org BYOK via user_byok_models.py. This
closes that gap for embeddings specifically -- but deliberately at the
ORGANIZATION level, not per-individual-user like chat, because an embedding
config isn't just "which model answers this one call" (stateless, safe to
swap turn to turn): document_chunks / schema_table_index rows are embedded
once and compared against live query vectors indefinitely, so every member of
an org querying the same knowledge base must resolve to the same embedding
config or retrieval silently returns garbage similarity scores. See the
module's own docstring for the full reasoning and the provider-support
citations (OpenRouter embeddings endpoint, no Anthropic/DeepSeek embeddings
API, no safe way to infer an Azure embedding deployment from a saved chat
deployment).
"""

import json

import pytest


def _row(monkeypatch, **fields):
    """Build the JSON string _get_org_provider_setting's raw.value would hold,
    with decrypt_credentials patched to a no-op passthrough (matches
    test_ollama_byok.py's convention)."""
    from src.modules.data.utils import credentials as creds_mod

    monkeypatch.setattr(creds_mod, "decrypt_credentials", lambda d: d)
    return json.dumps(fields)


class _FakeSettingEntry:
    def __init__(self, value):
        self.value = value


@pytest.mark.asyncio
class TestResolveOrgByokEmbeddingConfig:
    async def test_returns_none_when_no_organization_id(self):
        from ee.modules.ai.services.user_byok_embedding import resolve_org_byok_embedding_config

        assert await resolve_org_byok_embedding_config(None) is None
        assert await resolve_org_byok_embedding_config("") is None

    async def test_returns_none_when_org_has_no_provider_keys(self, monkeypatch):
        from ee.modules.ai.services import user_byok_embedding as mod

        async def fake_get_org_setting(organization_id, provider):
            return None

        monkeypatch.setattr(
            "ee.modules.ai.services.user_byok_models._get_org_provider_setting",
            fake_get_org_setting,
        )

        assert await mod.resolve_org_byok_embedding_config("org-1") is None

    async def test_openai_org_key_resolves_to_text_embedding_3_small(self, monkeypatch):
        from ee.modules.ai.services import user_byok_embedding as mod

        raw = _row(monkeypatch, api_key="sk-org-openai", model="gpt-4o-mini")

        async def fake_get_org_setting(organization_id, provider):
            if provider == "openai":
                return _FakeSettingEntry(raw)
            return None

        monkeypatch.setattr(
            "ee.modules.ai.services.user_byok_models._get_org_provider_setting",
            fake_get_org_setting,
        )

        cfg = await mod.resolve_org_byok_embedding_config("org-1")

        assert cfg is not None
        # Must use OpenAI's *embedding* model default, not the chat model
        # ("gpt-4o-mini" above) stored for chat completions -- that field is
        # meaningless for embeddings and would break the request outright.
        assert cfg["model"] == "text-embedding-3-small"
        assert cfg["api_key"] == "sk-org-openai"
        assert cfg["model_identity"] == "byok_org:openai:text-embedding-3-small"
        # text-embedding-3-small natively outputs 1536 dims; without requesting
        # a truncation, it silently mismatches the fixed vector(384) pgvector
        # column and every retrieval falls back to a slow JSONB linear scan
        # (see _get_embedding_api_batch) instead of erroring where it'd be noticed.
        assert cfg["dimensions"] == 384

    async def test_google_org_key_resolves_with_gemini_prefix(self, monkeypatch):
        from ee.modules.ai.services import user_byok_embedding as mod

        raw = _row(monkeypatch, api_key="g-key", model="gemini-3.6-flash")

        async def fake_get_org_setting(organization_id, provider):
            if provider == "google":
                return _FakeSettingEntry(raw)
            return None

        monkeypatch.setattr(
            "ee.modules.ai.services.user_byok_models._get_org_provider_setting",
            fake_get_org_setting,
        )

        cfg = await mod.resolve_org_byok_embedding_config("org-1")

        assert cfg["model"] == "gemini/gemini-embedding-001"
        assert cfg["api_key"] == "g-key"
        # gemini-embedding-001 natively outputs 3072 dims -- same truncation
        # requirement as OpenAI's model, see the openai test's comment above.
        assert cfg["dimensions"] == 384

    async def test_openrouter_org_key_routes_through_openrouter_prefix(self, monkeypatch):
        """Verified via WebSearch (OpenRouter's own docs, openrouter.ai/docs/
        api_reference/embeddings) that OpenRouter exposes a dedicated,
        OpenAI-compatible /api/v1/embeddings endpoint -- this isn't guessed."""
        from ee.modules.ai.services import user_byok_embedding as mod

        raw = _row(monkeypatch, api_key="or-key", model="qwen/qwen3.8-27b")

        async def fake_get_org_setting(organization_id, provider):
            if provider == "openrouter":
                return _FakeSettingEntry(raw)
            return None

        monkeypatch.setattr(
            "ee.modules.ai.services.user_byok_models._get_org_provider_setting",
            fake_get_org_setting,
        )

        cfg = await mod.resolve_org_byok_embedding_config("org-1")

        assert cfg["model"] == "openrouter/openai/text-embedding-3-small"
        assert cfg["api_key"] == "or-key"
        # Routes to the same underlying OpenAI model -- same truncation need.
        assert cfg["dimensions"] == 384

    async def test_ollama_org_key_needs_endpoint_not_api_key(self, monkeypatch):
        from ee.modules.ai.services import user_byok_embedding as mod

        raw = _row(monkeypatch, endpoint="http://ollama:11434", model="llama3.2:1b")

        async def fake_get_org_setting(organization_id, provider):
            if provider == "ollama":
                return _FakeSettingEntry(raw)
            return None

        monkeypatch.setattr(
            "ee.modules.ai.services.user_byok_models._get_org_provider_setting",
            fake_get_org_setting,
        )

        cfg = await mod.resolve_org_byok_embedding_config("org-1")

        assert cfg["model"] == "ollama/nomic-embed-text"
        assert cfg["api_base"] == "http://ollama:11434"
        assert cfg["api_key"] == "local"
        # Deliberately NOT truncated: Ollama-hosted models generally aren't
        # trained with Matryoshka nesting, so forcing a "dimensions" param
        # here would silently corrupt the vector rather than degrade
        # gracefully. A raw width mismatch against the pgvector column falls
        # back to the same slow-but-correct path every other un-truncated
        # provider already falls back to.
        assert "dimensions" not in cfg

    async def test_azure_openai_is_never_offered_for_embeddings(self, monkeypatch):
        """A saved azure_openai BYOK row only has the user's *chat* deployment
        name -- Azure requires embeddings to use their own distinct
        deployment, which isn't captured anywhere. Silently reusing the chat
        deployment here would reintroduce the exact bug
        embedding_service.py's _resolve_azure_embedding was already fixed
        against once. azure_openai must never be in the provider order."""
        from ee.modules.ai.services import user_byok_embedding as mod

        assert "azure_openai" not in mod._EMBEDDING_PROVIDER_ORDER

    async def test_anthropic_and_deepseek_are_never_offered_for_embeddings(self):
        """Anthropic has no embeddings API at all (Claude is chat-only); the
        official DeepSeek API reference (api-docs.deepseek.com) documents no
        embeddings endpoint either -- both confirmed via live lookup, not
        assumed, before this list was written."""
        from ee.modules.ai.services import user_byok_embedding as mod

        assert "anthropic" not in mod._EMBEDDING_PROVIDER_ORDER
        assert "deepseek" not in mod._EMBEDDING_PROVIDER_ORDER

    async def test_provider_missing_required_credential_is_skipped_not_raised(self, monkeypatch):
        """openai/google/openrouter need an api_key; a row saved with only an
        endpoint (shouldn't happen for these providers, but must fail soft)
        is treated as not-configured, not a crash."""
        from ee.modules.ai.services import user_byok_embedding as mod

        raw = _row(monkeypatch, api_key="", model="")

        async def fake_get_org_setting(organization_id, provider):
            if provider == "openai":
                return _FakeSettingEntry(raw)
            return None

        monkeypatch.setattr(
            "ee.modules.ai.services.user_byok_models._get_org_provider_setting",
            fake_get_org_setting,
        )

        assert await mod.resolve_org_byok_embedding_config("org-1") is None

    async def test_priority_order_prefers_openai_over_later_providers(self, monkeypatch):
        from ee.modules.ai.services import user_byok_embedding as mod

        openai_raw = _row(monkeypatch, api_key="openai-key")
        google_raw = json.dumps({"api_key": "google-key"})

        async def fake_get_org_setting(organization_id, provider):
            if provider == "openai":
                return _FakeSettingEntry(openai_raw)
            if provider == "google":
                return _FakeSettingEntry(google_raw)
            return None

        monkeypatch.setattr(
            "ee.modules.ai.services.user_byok_models._get_org_provider_setting",
            fake_get_org_setting,
        )

        cfg = await mod.resolve_org_byok_embedding_config("org-1")

        assert cfg["model"] == "text-embedding-3-small"
        assert cfg["api_key"] == "openai-key"

    async def test_org_lookup_exception_for_one_provider_does_not_abort_the_others(self, monkeypatch):
        """A transient DB error resolving one provider's setting must not
        prevent falling through to check the next provider in order."""
        from ee.modules.ai.services import user_byok_embedding as mod

        google_raw = json.dumps({"api_key": "google-key"})

        async def fake_get_org_setting(organization_id, provider):
            if provider == "openai":
                raise RuntimeError("db unavailable")
            if provider == "google":
                return _FakeSettingEntry(google_raw)
            return None

        monkeypatch.setattr(
            "ee.modules.ai.services.user_byok_models._get_org_provider_setting",
            fake_get_org_setting,
        )

        cfg = await mod.resolve_org_byok_embedding_config("org-1")

        assert cfg is not None
        assert cfg["api_key"] == "google-key"
