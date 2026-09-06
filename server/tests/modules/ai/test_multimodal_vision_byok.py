"""Tests for multimodal_ingestion.py's vision-capable-BYOK-model wiring.

Context: _summarize_image_parts (the only place in the AI pipeline that
actually sends real image_url content to an LLM -- "make it look like this
screenshot" dashboard reference images) always called generate_completion
with node_name="dashboard_reference_image_vision" and no model_id, which
model_tiering.resolve_model_for_node resolves via tier-based auto-routing
ONLY (it's called with user_model=None) -- meaning a user's own explicitly
selected model, BYOK included, was never used for this one call even when it
supports vision fine; the platform's own reasoning-tier model was always
used instead, spending the platform's budget/key rather than the user's own.

Fix: thread the request's already-resolved effective model id (api_streaming
.py's stream_model, post resolve_working_model_id()) through as
user_model_id, and use it as model_id when litellm_service.available_models
says it supports vision. Falls back to the pre-existing node_name-based tier
routing (unchanged) whenever there's no explicit selection or it isn't
vision-capable.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock


def _fake_litellm_service(available_models, generate_completion_result=None):
    service = MagicMock()
    service.available_models = available_models
    service.generate_completion = AsyncMock(
        return_value=generate_completion_result or {"success": True, "content": "- bullet one"}
    )
    return service


IMAGE_PART = {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc"}}


@pytest.mark.asyncio
class TestSummarizeImagePartsUsesByokVisionModel:
    async def test_vision_capable_byok_model_is_used_directly(self):
        from ee.modules.ai.services.multimodal_ingestion import _summarize_image_parts

        service = _fake_litellm_service(
            {"byok_openrouter": {"provider": "openrouter", "model": "openrouter/qwen/qwen3.8-27b", "name": "Qwen3.8 27B (OpenRouter)", "api_key": "k"}}
        )

        await _summarize_image_parts(
            [IMAGE_PART], litellm_service=service, user_model_id="byok_openrouter"
        )

        kwargs = service.generate_completion.await_args.kwargs
        assert kwargs["model_id"] == "byok_openrouter"
        assert kwargs["node_name"] == "dashboard_reference_image_vision"

    async def test_non_vision_byok_model_falls_back_to_tier_routing(self):
        """A user's BYOK model that does NOT support vision (e.g. a text-only
        DeepSeek pick) must NOT be forced onto this vision call -- model_id
        stays unset so generate_completion's existing tier-based routing
        (guaranteed vision-capable) picks the model instead."""
        from ee.modules.ai.services.multimodal_ingestion import _summarize_image_parts

        service = _fake_litellm_service(
            {"byok_deepseek": {"provider": "deepseek", "model": "deepseek/deepseek-v4-flash", "name": "DeepSeek V4 Flash", "api_key": "k"}}
        )

        await _summarize_image_parts(
            [IMAGE_PART], litellm_service=service, user_model_id="byok_deepseek"
        )

        kwargs = service.generate_completion.await_args.kwargs
        assert kwargs["model_id"] is None
        assert kwargs["node_name"] == "dashboard_reference_image_vision"

    async def test_no_user_model_id_behaves_exactly_as_before(self):
        """The pre-existing (no BYOK awareness) call shape: no model_id,
        tier-routing decides via node_name alone."""
        from ee.modules.ai.services.multimodal_ingestion import _summarize_image_parts

        service = _fake_litellm_service({})

        await _summarize_image_parts([IMAGE_PART], litellm_service=service, user_model_id=None)

        kwargs = service.generate_completion.await_args.kwargs
        assert kwargs["model_id"] is None

    async def test_unknown_user_model_id_falls_back_safely(self):
        """user_model_id pointing at a model id not in available_models
        (stale/edge-case) must not crash -- treated as no explicit
        selection."""
        from ee.modules.ai.services.multimodal_ingestion import _summarize_image_parts

        service = _fake_litellm_service({"some_other_model": {"provider": "openai", "model": "gpt-4o-mini"}})

        await _summarize_image_parts(
            [IMAGE_PART], litellm_service=service, user_model_id="byok_nonexistent"
        )

        kwargs = service.generate_completion.await_args.kwargs
        assert kwargs["model_id"] is None

    async def test_vision_capable_platform_default_selection_is_also_used(self):
        """Not BYOK-specific -- any explicitly resolved vision-capable model
        (platform or BYOK) should be honored, matching the docstring's
        "includes a hydrated BYOK selection" but not being exclusive to it."""
        from ee.modules.ai.services.multimodal_ingestion import _summarize_image_parts

        service = _fake_litellm_service(
            {"azure_gpt4o_mini": {"provider": "azure", "model": "azure/gpt-4o-mini", "name": "GPT-4o Mini", "api_key": "k"}}
        )

        await _summarize_image_parts(
            [IMAGE_PART], litellm_service=service, user_model_id="azure_gpt4o_mini"
        )

        kwargs = service.generate_completion.await_args.kwargs
        assert kwargs["model_id"] == "azure_gpt4o_mini"

    async def test_no_image_parts_short_circuits_before_touching_user_model_id(self):
        from ee.modules.ai.services.multimodal_ingestion import _summarize_image_parts

        service = _fake_litellm_service({})

        result = await _summarize_image_parts([], litellm_service=service, user_model_id="byok_openrouter")

        assert result == ""
        service.generate_completion.assert_not_awaited()


@pytest.mark.asyncio
async def test_ingest_attachments_threads_user_model_id_into_image_summary(monkeypatch):
    from ee.modules.ai.services.multimodal_ingestion import ingest_attachments

    captured = {}

    async def fake_summarize(image_parts, *, litellm_service=None, user_model_id=None):
        captured["user_model_id"] = user_model_id
        return "layout summary"

    monkeypatch.setattr(
        "ee.modules.ai.services.multimodal_ingestion._summarize_image_parts", fake_summarize
    )

    service = MagicMock()
    await ingest_attachments(
        [{"type": "image", "base64": "aGVsbG8="}],
        litellm_service=service,
        user_model_id="byok_openrouter",
    )

    assert captured["user_model_id"] == "byok_openrouter"
