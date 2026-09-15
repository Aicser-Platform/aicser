"""Regression tests: a user-saved Ollama endpoint must actually become a
selectable model, the same way OpenRouter/OpenAI/etc. BYOK keys do.

Root cause: four independent drops in ee/modules/ai/services/user_byok_models.py
all had to be fixed together for Ollama to work at all:
  1. PROVIDER_SETTING_KEYS didn't include "ollama" - the hydrate loop never
     even read provider_key.ollama from user_settings.
  2. BYOK_INTERNAL_ID had no "ollama" -> "byok_ollama" mapping.
  3. _parse_store unconditionally required a truthy api_key and returned None
     otherwise - but save_ai_provider_key (src/modules/user/router.py) saves
     Ollama with an endpoint and explicitly NO api_key (Ollama auths by
     network reachability, not a key), so every saved Ollama row was silently
     discarded here even if 1+2 were fixed.
  4. _build_litellm_config had no "ollama" branch and fell through to
     `return None` for it.

Fixing only some of the four still results in Ollama never appearing, since
each drop independently loses the row. Mirrors the shape already used by the
unrelated env-var-only Ollama path in litellm_service.py's
_register_private_models (provider="ollama", is_local=True), so both paths
produce entries the model selector treats identically.
"""

from ee.modules.ai.services.user_byok_models import (
    BYOK_INTERNAL_ID,
    PROVIDER_SETTING_KEYS,
    _build_litellm_config,
    _parse_store,
)


def test_ollama_is_a_recognized_provider_setting_key():
    assert "ollama" in PROVIDER_SETTING_KEYS


def test_ollama_has_a_byok_internal_id():
    assert BYOK_INTERNAL_ID.get("ollama") == "byok_ollama"


class TestParseStoreAcceptsEndpointOnlyForOllama:
    def test_ollama_row_with_no_api_key_is_accepted(self, monkeypatch):
        import json

        from src.modules.data.utils import credentials as creds_mod

        monkeypatch.setattr(creds_mod, "decrypt_credentials", lambda d: d)
        raw = json.dumps({"endpoint": "http://ollama:11434", "model": "llama3.2:1b"})

        row = _parse_store(raw, "ollama")

        assert row is not None
        assert row["endpoint"] == "http://ollama:11434"
        assert row["model"] == "llama3.2:1b"
        assert row["api_key"] == ""

    def test_ollama_row_with_no_endpoint_and_no_key_is_rejected(self, monkeypatch):
        import json

        from src.modules.data.utils import credentials as creds_mod

        monkeypatch.setattr(creds_mod, "decrypt_credentials", lambda d: d)
        raw = json.dumps({"model": "llama3.2:1b"})

        assert _parse_store(raw, "ollama") is None

    def test_other_providers_still_require_an_api_key(self, monkeypatch):
        import json

        from src.modules.data.utils import credentials as creds_mod

        monkeypatch.setattr(creds_mod, "decrypt_credentials", lambda d: d)
        raw = json.dumps({"endpoint": "https://api.openai.com", "model": "gpt-5.6-luna"})

        assert _parse_store(raw, "openai") is None


class TestBuildLitellmConfigForOllama:
    def test_builds_a_selectable_ollama_entry(self):
        built = _build_litellm_config(
            "ollama", {"api_key": "", "model": "llama3.2:1b", "endpoint": "http://ollama:11434"}
        )
        assert built is not None
        internal_id, cfg = built
        assert internal_id == "byok_ollama"
        assert cfg["provider"] == "ollama"
        assert cfg["model"] == "ollama/llama3.2:1b"
        assert cfg["api_base"] == "http://ollama:11434"
        assert cfg["is_local"] is True

    def test_missing_endpoint_is_rejected(self):
        assert _build_litellm_config("ollama", {"api_key": "", "model": "llama3.2:1b", "endpoint": ""}) is None

    def test_defaults_to_a_reasonable_model_when_none_saved(self):
        built = _build_litellm_config("ollama", {"api_key": "", "model": "", "endpoint": "http://ollama:11434"})
        assert built is not None
        _, cfg = built
        assert cfg["model"] == "ollama/llama3.2:1b"

    def test_strips_trailing_slash_from_endpoint(self):
        built = _build_litellm_config(
            "ollama", {"api_key": "", "model": "mistral", "endpoint": "http://ollama:11434/"}
        )
        assert built is not None
        _, cfg = built
        assert cfg["api_base"] == "http://ollama:11434"

    def test_display_name_is_clean_ollama_identified_via_provider_fields(self):
        # Name intentionally does NOT append "(Ollama)" - the picker already
        # shows the Ollama logo (provider) and a "Local" badge (is_local) for
        # this entry, so repeating the gateway name in the text label is
        # redundant. Same de-cluttering applied to Azure/OpenRouter BYOK names
        # and the platform's curated OpenRouter models.
        built = _build_litellm_config(
            "ollama", {"api_key": "", "model": "llama3.2:1b", "endpoint": "http://ollama:11434"}
        )
        assert built is not None
        _, cfg = built
        assert "Ollama" not in cfg["name"]
        assert cfg["provider"] == "ollama"
        assert cfg["is_local"] is True

    def test_unrecognized_provider_still_returns_none(self):
        assert _build_litellm_config("not-a-real-provider", {"api_key": "x", "model": "", "endpoint": ""}) is None
