"""Regression tests for embedding_service.py's provider resolution.

Context: EMBEDDING_PROVIDER used to default to "api", which always tried
AZURE_OPENAI_API_KEY/AZURE_OPENAI_ENDPOINT with an unprefixed OpenAI-style
model string ("text-embedding-3-small") -- Azure rejects that request shape
outright (litellm.AuthenticationError), and even a prefixed "azure/..." call
would have reused AZURE_OPENAI_DEPLOYMENT_NAME, which is the *chat*
deployment, not a deployment created for an embedding model. This silently
broke embeddings for any deployment that only had Azure creds configured for
chat, regardless of whether some other provider (e.g. a user's Gemini BYOK
key) was configured elsewhere -- embeddings never looked at those at all.

Also covers a second, independent bug found while fixing the above:
get_embedding_batch() unconditionally called the API-path batch fetcher and
never checked EMBEDDING_PROVIDER at all, so EMBEDDING_PROVIDER=local (the new
default) would silently return all-None results for any caller using the
batch API instead of the single-item one.
"""

import importlib
import sys

import pytest

MODULE_PATH = "ee.modules.ai.utils.embedding_service"


@pytest.fixture
def embedding_service(monkeypatch):
    """Import (or re-import) the module fresh so cached state doesn't leak between tests."""
    for env_var in [
        "EMBEDDING_PROVIDER", "EMBEDDING_MODEL", "EMBEDDING_LOCAL_MODEL",
        "EMBEDDING_API_KEY", "EMBEDDING_API_BASE", "EMBEDDING_API_VERSION",
        "EMBEDDING_DIMENSIONS",
        "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_API_VERSION",
        "AZURE_OPENAI_DEPLOYMENT_NAME", "AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME",
        "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY",
    ]:
        monkeypatch.delenv(env_var, raising=False)
    if MODULE_PATH in sys.modules:
        mod = importlib.reload(sys.modules[MODULE_PATH])
    else:
        mod = importlib.import_module(MODULE_PATH)
    mod._embedding_cache.clear()
    mod._local_model_cache.clear()
    return mod


def test_default_provider_is_local(embedding_service):
    assert embedding_service._embedding_provider() == "local"


def test_azure_resolver_uses_embedding_deployment_not_chat_deployment(embedding_service, monkeypatch):
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "azure-key")
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.openai.azure.com")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT_NAME", "chat-deploy")
    monkeypatch.setenv("AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME", "embed-deploy")

    cfg = embedding_service._resolve_azure_embedding()

    assert cfg["model"] == "azure/embed-deploy"
    assert "chat-deploy" not in cfg["model"]


def test_azure_resolver_prefixes_model_with_azure(embedding_service, monkeypatch):
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "azure-key")
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.openai.azure.com")
    monkeypatch.setenv("EMBEDDING_MODEL", "text-embedding-3-small")

    cfg = embedding_service._resolve_azure_embedding()

    assert cfg["model"] == "azure/text-embedding-3-small"
    assert cfg["api_key"] == "azure-key"
    assert cfg["api_base"] == "https://example.openai.azure.com"


def test_env_or_treats_present_but_empty_as_unset(embedding_service, monkeypatch):
    """docker-compose's ${VAR:-} substitutes an empty string for an unset host
    var rather than leaving the container var unset -- os.getenv(key, default)
    only falls back on absence, so a compose-injected "" used to silently beat
    the intended default. Reproduced live: EMBEDDING_LOCAL_MODEL="" made
    local embeddings resolve to model id "local:" (empty) and fail outright."""
    monkeypatch.setenv("EMBEDDING_LOCAL_MODEL", "")

    assert embedding_service._env_or("EMBEDDING_LOCAL_MODEL", "BAAI/bge-small-en-v1.5") == "BAAI/bge-small-en-v1.5"


def test_local_model_id_not_empty_when_env_var_present_but_blank(embedding_service, monkeypatch):
    monkeypatch.setenv("EMBEDDING_LOCAL_MODEL", "")

    model_id = embedding_service.current_embedding_model_id()

    assert model_id == "local:intfloat/multilingual-e5-small"


def test_google_resolver_defaults_and_prefixes_gemini(embedding_service, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")

    cfg = embedding_service._resolve_google_embedding()

    assert cfg["model"] == "gemini/gemini-embedding-001"
    assert cfg["api_key"] == "gemini-key"


def test_google_resolver_falls_back_to_google_api_key(embedding_service, monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "google-key")

    cfg = embedding_service._resolve_google_embedding()

    assert cfg["api_key"] == "google-key"


@pytest.mark.asyncio
async def test_unknown_provider_skips_without_raising(embedding_service, monkeypatch):
    monkeypatch.setenv("EMBEDDING_PROVIDER", "not_a_real_provider")

    result = await embedding_service._get_embedding_api_batch(["hello"])

    assert result == [None]


@pytest.mark.asyncio
async def test_provider_missing_api_key_skips_without_raising(embedding_service, monkeypatch):
    monkeypatch.setenv("EMBEDDING_PROVIDER", "openai")
    # No OPENAI_API_KEY / EMBEDDING_API_KEY set.

    result = await embedding_service._get_embedding_api_batch(["hello"])

    assert result == [None]


@pytest.mark.asyncio
async def test_get_embedding_batch_dispatches_to_local_batch_when_provider_is_local(
    embedding_service, monkeypatch
):
    """The bug: this used to call _get_embedding_api_batch unconditionally,
    ignoring EMBEDDING_PROVIDER=local entirely."""
    calls = {"local": 0, "api": 0}

    async def fake_local_batch(texts):
        calls["local"] += 1
        return [[0.1, 0.2] for _ in texts]

    async def fake_api_batch(texts):
        calls["api"] += 1
        return [None for _ in texts]

    monkeypatch.setattr(embedding_service, "_get_embedding_local_batch", fake_local_batch)
    monkeypatch.setattr(embedding_service, "_get_embedding_api_batch", fake_api_batch)

    result = await embedding_service.get_embedding_batch(["a", "b"])

    assert calls["local"] == 1
    assert calls["api"] == 0
    assert result == [[0.1, 0.2], [0.1, 0.2]]


@pytest.mark.asyncio
async def test_get_embedding_batch_dispatches_to_api_when_provider_is_not_local(
    embedding_service, monkeypatch
):
    monkeypatch.setenv("EMBEDDING_PROVIDER", "openai")
    calls = {"local": 0, "api": 0}

    async def fake_local_batch(texts):
        calls["local"] += 1
        return [None for _ in texts]

    async def fake_api_batch(texts):
        calls["api"] += 1
        return [[0.3, 0.4] for _ in texts]

    monkeypatch.setattr(embedding_service, "_get_embedding_local_batch", fake_local_batch)
    monkeypatch.setattr(embedding_service, "_get_embedding_api_batch", fake_api_batch)

    result = await embedding_service.get_embedding_batch(["a"])

    assert calls["api"] == 1
    assert calls["local"] == 0
    assert result == [[0.3, 0.4]]


def test_current_embedding_model_id_reflects_provider_and_model(embedding_service, monkeypatch):
    monkeypatch.setenv("EMBEDDING_PROVIDER", "google")
    monkeypatch.setenv("GEMINI_API_KEY", "k")

    model_id = embedding_service.current_embedding_model_id()

    assert model_id == "google:gemini/gemini-embedding-001"


def test_embedding_dimensions_unset_returns_none(embedding_service):
    assert embedding_service._embedding_dimensions() is None


def test_embedding_dimensions_parses_valid_int(embedding_service, monkeypatch):
    monkeypatch.setenv("EMBEDDING_DIMENSIONS", "384")
    assert embedding_service._embedding_dimensions() == 384


def test_embedding_dimensions_ignores_non_integer(embedding_service, monkeypatch):
    monkeypatch.setenv("EMBEDDING_DIMENSIONS", "not-a-number")
    assert embedding_service._embedding_dimensions() is None


def test_embedding_dimensions_ignores_non_positive(embedding_service, monkeypatch):
    monkeypatch.setenv("EMBEDDING_DIMENSIONS", "0")
    assert embedding_service._embedding_dimensions() is None


def test_current_embedding_model_id_includes_dimensions_when_set(embedding_service, monkeypatch):
    """A dimensions-only config change (same model, truncated width) is a
    different vector space -- must be detected as a model change too, the
    same as changing EMBEDDING_MODEL itself (see the function's docstring)."""
    monkeypatch.setenv("EMBEDDING_PROVIDER", "openai_compat")
    monkeypatch.setenv("EMBEDDING_API_BASE", "http://localhost:11434/v1")
    monkeypatch.setenv("EMBEDDING_MODEL", "qwen3-embedding-8b")
    monkeypatch.setenv("EMBEDDING_DIMENSIONS", "384")

    model_id = embedding_service.current_embedding_model_id()

    assert model_id == "openai_compat:qwen3-embedding-8b@384"


@pytest.mark.asyncio
async def test_get_embedding_api_batch_passes_dimensions_through_when_set(embedding_service, monkeypatch):
    monkeypatch.setenv("EMBEDDING_PROVIDER", "openai_compat")
    monkeypatch.setenv("EMBEDDING_API_BASE", "http://localhost:11434/v1")
    monkeypatch.setenv("EMBEDDING_MODEL", "qwen3-embedding-8b")
    monkeypatch.setenv("EMBEDDING_DIMENSIONS", "384")

    captured = {}

    class _Item:
        def __init__(self, vec):
            self.embedding = vec

    class _Response:
        data = [_Item([0.1] * 384)]

    async def fake_aembedding(**kwargs):
        captured.update(kwargs)
        return _Response()

    fake_litellm = type(sys)("litellm")
    fake_litellm.aembedding = fake_aembedding
    monkeypatch.setitem(sys.modules, "litellm", fake_litellm)

    result = await embedding_service._get_embedding_api_batch(["hello"])

    assert captured.get("dimensions") == 384
    assert result == [[0.1] * 384]


@pytest.mark.asyncio
async def test_get_embedding_api_batch_omits_dimensions_when_unset(embedding_service, monkeypatch):
    monkeypatch.setenv("EMBEDDING_PROVIDER", "openai_compat")
    monkeypatch.setenv("EMBEDDING_API_BASE", "http://localhost:11434/v1")
    monkeypatch.setenv("EMBEDDING_MODEL", "some-model")

    captured = {}

    class _Item:
        def __init__(self, vec):
            self.embedding = vec

    class _Response:
        data = [_Item([0.1, 0.2])]

    async def fake_aembedding(**kwargs):
        captured.update(kwargs)
        return _Response()

    fake_litellm = type(sys)("litellm")
    fake_litellm.aembedding = fake_aembedding
    monkeypatch.setitem(sys.modules, "litellm", fake_litellm)

    await embedding_service._get_embedding_api_batch(["hello"])

    assert "dimensions" not in captured


class TestOrgByokEmbeddingRouting:
    """Org BYOK embeddings must take precedence over the EMBEDDING_PROVIDER
    env config when the resolving organization has a key configured -- and
    the shared module-level _embedding_cache must never hand back a vector
    produced by a *different* model just because two calls happened to embed
    the same text. Before org-scoped BYOK, only one model could ever be live
    per process, so that collision wasn't reachable; it is now (org A has a
    BYOK key, org B doesn't, same process)."""

    @pytest.mark.asyncio
    async def test_get_embedding_uses_org_byok_config_instead_of_env_provider(
        self, embedding_service, monkeypatch
    ):
        monkeypatch.setenv("EMBEDDING_PROVIDER", "openai")
        monkeypatch.setenv("OPENAI_API_KEY", "platform-key")

        captured = {}

        async def fake_org_cfg(organization_id):
            assert organization_id == "org-1"
            return {
                "model": "openrouter/openai/text-embedding-3-small",
                "api_key": "org-byok-key",
                "model_identity": "byok_org:openrouter:openai/text-embedding-3-small",
            }

        async def fake_aembedding(**kwargs):
            captured.update(kwargs)

            class _Item:
                embedding = [0.9, 0.8]

            class _Response:
                data = [_Item()]

            return _Response()

        monkeypatch.setattr(
            "ee.modules.ai.services.user_byok_embedding.resolve_org_byok_embedding_config",
            fake_org_cfg,
        )
        fake_litellm = type(sys)("litellm")
        fake_litellm.aembedding = fake_aembedding
        monkeypatch.setitem(sys.modules, "litellm", fake_litellm)

        result = await embedding_service.get_embedding("hello", organization_id="org-1")

        assert result == [0.9, 0.8]
        assert captured["model"] == "openrouter/openai/text-embedding-3-small"
        assert captured["api_key"] == "org-byok-key"

    @pytest.mark.asyncio
    async def test_falls_back_to_env_provider_when_org_has_no_byok_key(
        self, embedding_service, monkeypatch
    ):
        monkeypatch.setenv("EMBEDDING_PROVIDER", "openai")
        monkeypatch.setenv("OPENAI_API_KEY", "platform-key")

        async def fake_org_cfg(organization_id):
            return None

        captured = {}

        async def fake_aembedding(**kwargs):
            captured.update(kwargs)

            class _Item:
                embedding = [0.1]

            class _Response:
                data = [_Item()]

            return _Response()

        monkeypatch.setattr(
            "ee.modules.ai.services.user_byok_embedding.resolve_org_byok_embedding_config",
            fake_org_cfg,
        )
        fake_litellm = type(sys)("litellm")
        fake_litellm.aembedding = fake_aembedding
        monkeypatch.setitem(sys.modules, "litellm", fake_litellm)

        await embedding_service.get_embedding("hello", organization_id="org-1")

        assert captured["api_key"] == "platform-key"

    @pytest.mark.asyncio
    async def test_picks_up_organization_id_from_ambient_request_context_when_not_passed_explicitly(
        self, embedding_service, monkeypatch
    ):
        """Most embedding call sites (schema RAG, few-shot retrieval, ...)
        don't have an organization_id parameter threaded through their whole
        call chain and never will without a much larger refactor -- the
        ambient AI request context api_streaming.py already sets per-request
        (organization_id, user_id) is how they get org BYOK embeddings
        without any signature changes on their part."""
        from ee.modules.ai.observability.request_context import (
            clear_ai_request_context,
            start_ai_request_context,
        )

        monkeypatch.setenv("EMBEDDING_PROVIDER", "local")
        seen = {}

        async def fake_org_cfg(organization_id):
            seen["organization_id"] = organization_id
            return None

        monkeypatch.setattr(
            "ee.modules.ai.services.user_byok_embedding.resolve_org_byok_embedding_config",
            fake_org_cfg,
        )

        async def fake_local(text):
            return [0.2]

        monkeypatch.setattr(embedding_service, "_get_embedding_local", fake_local)

        token = start_ai_request_context(request_id="req-1", organization_id="ambient-org-42")
        try:
            await embedding_service.get_embedding("hello")
        finally:
            clear_ai_request_context(token)

        assert seen["organization_id"] == "ambient-org-42"

    @pytest.mark.asyncio
    async def test_explicit_organization_id_wins_over_ambient_context(self, embedding_service, monkeypatch):
        from ee.modules.ai.observability.request_context import (
            clear_ai_request_context,
            start_ai_request_context,
        )

        monkeypatch.setenv("EMBEDDING_PROVIDER", "local")
        seen = {}

        async def fake_org_cfg(organization_id):
            seen["organization_id"] = organization_id
            return None

        monkeypatch.setattr(
            "ee.modules.ai.services.user_byok_embedding.resolve_org_byok_embedding_config",
            fake_org_cfg,
        )

        async def fake_local(text):
            return [0.2]

        monkeypatch.setattr(embedding_service, "_get_embedding_local", fake_local)

        token = start_ai_request_context(request_id="req-1", organization_id="ambient-org-42")
        try:
            await embedding_service.get_embedding("hello", organization_id="explicit-org-7")
        finally:
            clear_ai_request_context(token)

        assert seen["organization_id"] == "explicit-org-7"

    @pytest.mark.asyncio
    async def test_no_organization_id_and_no_ambient_context_uses_platform_config(
        self, embedding_service, monkeypatch
    ):
        """Background jobs (no live request, no ambient AI request context)
        must behave exactly as before this feature existed."""
        monkeypatch.setenv("EMBEDDING_PROVIDER", "local")
        calls = {"local": 0}

        async def fake_local(text):
            calls["local"] += 1
            return [0.5]

        monkeypatch.setattr(embedding_service, "_get_embedding_local", fake_local)

        result = await embedding_service.get_embedding("hello")

        assert result == [0.5]
        assert calls["local"] == 1

    @pytest.mark.asyncio
    async def test_cache_key_distinguishes_platform_and_org_byok_vectors_for_same_text(
        self, embedding_service, monkeypatch
    ):
        """Regression: _cache_key used to hash only (instruction_prefix +
        text), with no model identity in it. Once two different orgs sharing
        one process can resolve two different embedding models for the exact
        same input text, the second org's call would silently return the
        first org's cached vector -- wrong vector space, not just a wrong
        value, and no error anywhere to notice it."""
        monkeypatch.delenv("EMBEDDING_PROVIDER", raising=False)  # defaults to local

        org_calls = {"n": 0}

        async def fake_org_cfg(organization_id):
            if organization_id == "org-with-byok":
                org_calls["n"] += 1
                return {
                    "model": "openrouter/openai/text-embedding-3-small",
                    "api_key": "org-key",
                    "model_identity": "byok_org:openrouter:openai/text-embedding-3-small",
                }
            return None

        async def fake_local(text):
            return [0.1, 0.1]

        async def fake_api(text, org_cfg=None):
            return [0.9, 0.9]

        monkeypatch.setattr(
            "ee.modules.ai.services.user_byok_embedding.resolve_org_byok_embedding_config",
            fake_org_cfg,
        )
        monkeypatch.setattr(embedding_service, "_get_embedding_local", fake_local)
        monkeypatch.setattr(embedding_service, "_get_embedding_api", fake_api)

        # Same text, two different orgs -- must not collide in the cache.
        no_byok_result = await embedding_service.get_embedding("shared query text", organization_id="org-without-byok")
        byok_result = await embedding_service.get_embedding("shared query text", organization_id="org-with-byok")

        assert no_byok_result == [0.1, 0.1]
        assert byok_result == [0.9, 0.9]

    @pytest.mark.asyncio
    async def test_use_org_byok_false_ignores_explicit_organization_id(self, embedding_service, monkeypatch):
        """schema RAG (schema_retrieval_service.py, schema_domain_service.py)
        and schema indexing (schema_index_service.py) pass use_org_byok=False
        deliberately -- schema_table_index is built by a request path with no
        ambient org context, so query-time must stay on the platform-wide
        config too, or a BYOK-configured org would silently compare a
        platform-embedded index against a BYOK query vector (different
        vector space, no error, just wrong results)."""
        monkeypatch.setenv("EMBEDDING_PROVIDER", "local")
        org_calls = {"n": 0}

        async def fake_org_cfg(organization_id):
            org_calls["n"] += 1
            return {"model": "m", "api_key": "k", "model_identity": "byok_org:openai:m"}

        async def fake_local(text):
            return [0.4]

        monkeypatch.setattr(
            "ee.modules.ai.services.user_byok_embedding.resolve_org_byok_embedding_config",
            fake_org_cfg,
        )
        monkeypatch.setattr(embedding_service, "_get_embedding_local", fake_local)

        result = await embedding_service.get_embedding(
            "hello", organization_id="org-1", use_org_byok=False
        )

        assert result == [0.4]
        assert org_calls["n"] == 0

    @pytest.mark.asyncio
    async def test_use_org_byok_false_also_gates_get_embedding_batch(self, embedding_service, monkeypatch):
        monkeypatch.setenv("EMBEDDING_PROVIDER", "local")
        org_calls = {"n": 0}

        async def fake_org_cfg(organization_id):
            org_calls["n"] += 1
            return {"model": "m", "api_key": "k", "model_identity": "byok_org:openai:m"}

        async def fake_local_batch(texts):
            return [[0.4] for _ in texts]

        monkeypatch.setattr(
            "ee.modules.ai.services.user_byok_embedding.resolve_org_byok_embedding_config",
            fake_org_cfg,
        )
        monkeypatch.setattr(embedding_service, "_get_embedding_local_batch", fake_local_batch)

        result = await embedding_service.get_embedding_batch(
            ["hello"], organization_id="org-1", use_org_byok=False
        )

        assert result == [[0.4]]
        assert org_calls["n"] == 0

    @pytest.mark.asyncio
    async def test_current_embedding_model_id_async_reflects_org_byok(self, embedding_service, monkeypatch):
        monkeypatch.setenv("EMBEDDING_PROVIDER", "local")

        async def fake_org_cfg(organization_id):
            return {
                "model": "text-embedding-3-small",
                "api_key": "k",
                "model_identity": "byok_org:openai:text-embedding-3-small",
            }

        monkeypatch.setattr(
            "ee.modules.ai.services.user_byok_embedding.resolve_org_byok_embedding_config",
            fake_org_cfg,
        )

        model_id = await embedding_service.current_embedding_model_id_async("org-1")

        assert model_id == "byok_org:openai:text-embedding-3-small"

    @pytest.mark.asyncio
    async def test_current_embedding_model_id_async_falls_back_without_org_byok(
        self, embedding_service, monkeypatch
    ):
        monkeypatch.setenv("EMBEDDING_PROVIDER", "local")

        async def fake_org_cfg(organization_id):
            return None

        monkeypatch.setattr(
            "ee.modules.ai.services.user_byok_embedding.resolve_org_byok_embedding_config",
            fake_org_cfg,
        )

        model_id = await embedding_service.current_embedding_model_id_async("org-1")

        assert model_id == "local:intfloat/multilingual-e5-small"


def test_local_model_cache_reuses_loaded_model(embedding_service, monkeypatch):
    load_calls = {"count": 0}

    class _FakeModel:
        pass

    def fake_ctor(name, truncate_dim=None):
        load_calls["count"] += 1
        return _FakeModel()

    fake_module = type(sys)("sentence_transformers")
    fake_module.SentenceTransformer = fake_ctor
    monkeypatch.setitem(sys.modules, "sentence_transformers", fake_module)

    m1 = embedding_service._load_local_model("BAAI/bge-small-en-v1.5")
    m2 = embedding_service._load_local_model("BAAI/bge-small-en-v1.5")

    assert m1 is m2
    assert load_calls["count"] == 1


def test_local_model_load_requests_matryoshka_truncation_to_384(embedding_service, monkeypatch):
    """document_chunks.embedding_vector / schema_table_index are fixed vector(384)
    columns -- the default local model (multilingual-e5-small) natively outputs
    1024 dims, so skipping this would silently fall back to a full JSONB scan on
    every retrieval (see _LOCAL_MODEL_TRUNCATE_DIM's own comment)."""
    captured = {}

    class _FakeModel:
        pass

    def fake_ctor(name, truncate_dim=None):
        captured["name"] = name
        captured["truncate_dim"] = truncate_dim
        return _FakeModel()

    fake_module = type(sys)("sentence_transformers")
    fake_module.SentenceTransformer = fake_ctor
    monkeypatch.setitem(sys.modules, "sentence_transformers", fake_module)

    embedding_service._local_model_cache.clear()
    embedding_service._load_local_model("intfloat/multilingual-e5-small")

    assert captured["truncate_dim"] == 384
