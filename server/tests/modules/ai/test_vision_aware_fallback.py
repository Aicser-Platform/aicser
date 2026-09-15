"""Regression tests: get_fallback_model_id() had zero vision-capability
awareness -- it picked a fallback purely by "different provider, has
credentials", with no consideration of whether the ORIGINAL call sent real
image content. On this platform's specific configured fallback chain the
two candidates happen to both be vision-capable (GPT-4.1-mini, GPT-4o-mini),
so this was accidental correctness, not a guarantee -- any org whose
fallback chain includes a text-only model would have a vision call silently
fail over to it with no signal the image was never read.

_model_supports_vision / _messages_contain_image / get_fallback_model_id's
new requires_vision param close this: a vision call's fallback selection
now skips non-vision candidates, only relaxing back to "any available
model" if truly nothing vision-capable is configured (a degraded text-only
answer beats a hard failure).
"""

from ee.modules.ai.services.litellm_service import (
    LiteLLMService,
    _messages_contain_image,
    _model_supports_vision,
)


def test_model_supports_vision_by_name_pattern():
    assert _model_supports_vision({"model": "azure/gpt-4.1-mini"}) is True
    assert _model_supports_vision({"model": "mimo-v2.5"}) is True
    assert _model_supports_vision({"model": "deepseek-v4-flash"}) is False
    assert _model_supports_vision({"model": "ollama/llama3.1:8b"}) is False


def test_model_supports_vision_explicit_override_wins():
    """A BYOK/custom model can self-declare, for models the name-pattern
    list doesn't know about yet (e.g. a brand-new local release)."""
    assert _model_supports_vision({"model": "some-brand-new-model", "supports_vision": True}) is True
    assert _model_supports_vision({"model": "gpt-4o", "supports_vision": False}) is False


def test_messages_contain_image_detects_image_url_parts():
    text_only = [{"role": "user", "content": "hello"}]
    assert _messages_contain_image(text_only) is False

    with_image = [
        {"role": "system", "content": "You are an assistant."},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "describe this"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc"}},
            ],
        },
    ]
    assert _messages_contain_image(with_image) is True


def _make_service(models):
    service = LiteLLMService()
    service.available_models = dict(models)
    service.default_model = next(iter(models))
    service._model_availability_cache = {}
    service._model_cache_timestamps = {}
    return service


def test_fallback_skips_non_vision_model_when_vision_required():
    service = _make_service(
        {
            "primary": {"provider": "azure", "model": "azure/deepseek-v4-flash", "api_key": "k1", "api_base": "https://x"},
            "text_only_fallback": {"provider": "openai", "model": "deepseek-v4-flash", "api_key": "k2"},
            "vision_fallback": {"provider": "openai", "model": "gpt-4o-mini", "api_key": "k3"},
        }
    )
    result = service.get_fallback_model_id("primary", requires_vision=True)
    assert result == "vision_fallback"


def test_fallback_without_vision_requirement_unaffected():
    """Non-vision calls must keep today's behavior exactly -- first
    different-provider candidate, no filtering."""
    service = _make_service(
        {
            "primary": {"provider": "azure", "model": "azure/deepseek-v4-flash", "api_key": "k1", "api_base": "https://x"},
            "text_only_fallback": {"provider": "openai", "model": "deepseek-v4-flash", "api_key": "k2"},
        }
    )
    result = service.get_fallback_model_id("primary", requires_vision=False)
    assert result == "text_only_fallback"


def test_fallback_relaxes_to_any_model_when_no_vision_candidate_exists():
    """A degraded text-only answer beats a hard failure when nothing
    vision-capable is configured at all."""
    service = _make_service(
        {
            "primary": {"provider": "azure", "model": "azure/deepseek-v4-flash", "api_key": "k1", "api_base": "https://x"},
            "text_only_fallback": {"provider": "openai", "model": "deepseek-v4-flash", "api_key": "k2"},
        }
    )
    result = service.get_fallback_model_id("primary", requires_vision=True)
    assert result == "text_only_fallback"
