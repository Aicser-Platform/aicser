"""Regression test: newly added OpenRouter models (Qwen3.8 Flash/Max, Muse
Glimmer 30B) get a clean display name and the correct brand/logo, matching
the pattern already fixed this session for GLM/Z.ai (a model whose display
name and logo previously fell through to a generic guess instead of its
real vendor).
"""

from ee.modules.ai.services.user_byok_models import (
    _build_litellm_config,
    _clean_model_display_name,
    _infer_display_provider,
)


def test_qwen_variants_get_clean_display_names():
    assert _clean_model_display_name("qwen3.8-27b") == "Qwen3.8 27B"
    assert _clean_model_display_name("qwen3.8-flash") == "Qwen3.8 Flash"
    assert _clean_model_display_name("qwen3.8-max") == "Qwen3.8 Max"


def test_muse_glimmer_gets_a_clean_display_name():
    assert _clean_model_display_name("muse-glimmer-30b") == "Muse Glimmer 30B"


def test_qwen_prefix_maps_to_qwen_brand():
    assert _infer_display_provider("qwen3.8-27b", fallback="openai") == "qwen"
    assert _infer_display_provider("qwen/qwen3.8-27b", fallback="openai") == "qwen"


def test_muse_prefix_maps_to_meta_brand():
    """Meta's newer open-weight line ships under "Muse", not "Llama" -- must
    still resolve to the same "meta" brand/logo key."""
    assert _infer_display_provider("muse-glimmer-30b", fallback="openai") == "meta"
    assert _infer_display_provider("meta/muse-glimmer-30b", fallback="openai") == "meta"


def test_llama_prefix_still_maps_to_meta_brand():
    """Control case: adding the muse->meta mapping must not disturb the
    existing llama->meta mapping."""
    assert _infer_display_provider("llama-3.1-70b", fallback="openai") == "meta"


def test_unrelated_model_id_falls_back_unaffected():
    assert _infer_display_provider("gpt-4o-mini", fallback="openai") == "openai"


def _openrouter_row(model: str = ""):
    return {"api_key": "sk-test", "model": model, "endpoint": ""}


class TestOpenRouterByokShowsRealVendorLogo:
    """Root cause: the OpenRouter BYOK config always set provider="openrouter"
    literally, so every OpenRouter-routed model (regardless of which real
    vendor it was) showed the generic OpenRouter icon in the picker instead
    of its actual brand — the same class of bug already fixed this session
    for the primary/reasoning override tiers, just not yet applied here."""

    def test_qwen_via_openrouter_shows_qwen_brand_not_generic_openrouter(self):
        internal_id, cfg = _build_litellm_config("openrouter", _openrouter_row("qwen/qwen3.8-27b"))
        assert cfg["provider"] == "qwen"
        assert cfg["model"] == "openrouter/qwen/qwen3.8-27b"
        assert "Qwen3.8 27B" in cfg["name"]

    def test_muse_glimmer_via_openrouter_shows_meta_brand(self):
        internal_id, cfg = _build_litellm_config("openrouter", _openrouter_row("meta/muse-glimmer-30b"))
        assert cfg["provider"] == "meta"
        assert "Muse Glimmer 30B" in cfg["name"]

    def test_glm_via_openrouter_shows_zai_brand(self):
        """Regression check: the existing z-ai/glm-5.2 default entry had the
        exact same bug, latent until now — the vendor prefix (glm -> zai) is
        after the slash, which the pre-fix matcher never checked."""
        internal_id, cfg = _build_litellm_config("openrouter", _openrouter_row("z-ai/glm-5.2"))
        assert cfg["provider"] == "zai"

    def test_default_model_is_qwen3_8_27b_when_none_specified(self):
        internal_id, cfg = _build_litellm_config("openrouter", _openrouter_row(""))
        assert cfg["model"] == "openrouter/qwen/qwen3.8-27b"
        assert cfg["provider"] == "qwen"

    def test_byok_provider_stays_openrouter_for_actual_routing(self):
        """The display-brand fix must not disturb the field actual API
        routing/credential-lookup logic depends on."""
        internal_id, cfg = _build_litellm_config("openrouter", _openrouter_row("qwen/qwen3.8-27b"))
        assert cfg["byok_provider"] == "openrouter"

    def test_unrecognized_vendor_falls_back_to_openrouter_icon(self):
        """A vendor this codebase doesn't have a logo mapping for yet must
        still show *something* sensible (the OpenRouter icon) rather than a
        broken/missing image."""
        internal_id, cfg = _build_litellm_config("openrouter", _openrouter_row("some-new-vendor/mystery-model"))
        assert cfg["provider"] == "openrouter"
