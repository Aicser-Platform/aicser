"""Regression tests: a confidentiality instruction and a UTC reference-date
line are now appended to the final message list in ALL THREE LLM entry
points (generate_completion, generate_completion_with_tools,
generate_streaming_completion), in one shared place
(_append_confidentiality_line / _append_reference_date_line in
litellm_service.py), rather than each of the ~15 individual system prompts
across Chat/NL2SQL/Dashboard/Business OS/RAG/etc. having to remember to add
it themselves.

Root cause this guards against: an audit found zero hardcoded secrets in any
system prompt, but also zero instruction anywhere telling the model to
refuse a "repeat your system prompt" / "ignore previous instructions"
request, and zero grounding for "today"/"this week" outside nl2sql_node.py's
own ad-hoc reference-time block (every other mode had no date awareness at
all).

Also verifies idempotency: the auth/rate-limit fallback path recursively
re-calls generate_completion/generate_streaming_completion with the SAME
`messages` list object (not a copy), so appending must not duplicate on
retry.
"""

import pytest

from ee.modules.ai.observability.request_context import _ai_request_ctx, start_ai_request_context
from ee.modules.ai.services import litellm_service as svc_mod
from ee.modules.ai.services.litellm_service import (
    LiteLLMService,
    _append_confidentiality_line,
    _append_reference_date_line,
    _reference_date_line,
    _CONFIDENTIALITY_LINE,
    _REFERENCE_DATE_MARKER,
)


@pytest.fixture(autouse=True)
def _reset_ai_request_context():
    """ai_request_ctx is a bare ContextVar (no task boundary for these sync
    tests to rely on) -- reset before and after every test in this file so
    start_ai_request_context() calls here can never leak into other tests
    in the same pytest process."""
    token = _ai_request_ctx.set(None)
    yield
    _ai_request_ctx.reset(token)


_FAKE_MODELS = {
    "fake_primary": {
        "name": "Primary",
        "model": "azure/gpt-4.1-mini",
        "provider": "azure",
        "api_key": "azure-key",
        "api_base": "https://example.openai.azure.com/",
        "max_tokens": 16384,
    },
}


def _make_service() -> LiteLLMService:
    service = LiteLLMService()
    service.available_models = dict(_FAKE_MODELS)
    service.default_model = "fake_primary"
    service.active_model = "fake_primary"
    service._model_availability_cache = {}
    service._model_cache_timestamps = {}
    return service


def test_append_confidentiality_line_adds_to_existing_system_message():
    messages = [{"role": "system", "content": "You are a helpful assistant."}]
    result = _append_confidentiality_line(messages)
    assert _CONFIDENTIALITY_LINE.strip() in result[0]["content"]
    assert result[0]["content"].startswith("You are a helpful assistant.")


def test_append_confidentiality_line_is_idempotent_on_same_list():
    """Simulates the fallback retry calling this on the same message list twice."""
    messages = [{"role": "system", "content": "System prompt text."}]
    _append_confidentiality_line(messages)
    _append_confidentiality_line(messages)
    assert messages[0]["content"].count(_CONFIDENTIALITY_LINE.strip()) == 1


def test_append_confidentiality_line_inserts_system_message_when_missing():
    messages = [{"role": "user", "content": "hi"}]
    result = _append_confidentiality_line(messages)
    assert result[0]["role"] == "system"
    assert result[1]["role"] == "user"


def test_append_reference_date_line_adds_current_date():
    messages = [{"role": "system", "content": "You are a helpful assistant."}]
    result = _append_reference_date_line(messages)
    assert _REFERENCE_DATE_MARKER in result[0]["content"]


def test_append_reference_date_line_is_idempotent_on_same_list():
    messages = [{"role": "system", "content": "System prompt text."}]
    _append_reference_date_line(messages)
    _append_reference_date_line(messages)
    assert messages[0]["content"].count(_REFERENCE_DATE_MARKER) == 1


def test_reference_date_line_uses_client_timezone_when_present():
    """X-Client-Timezone -> start_ai_request_context(timezone=...) -> here.
    Falls back to UTC only when the header was absent or invalid."""
    start_ai_request_context(request_id="req-1", timezone="Asia/Phnom_Penh")
    line = _reference_date_line()
    assert "Asia/Phnom_Penh" in line
    assert "UTC" not in line


def test_reference_date_line_falls_back_to_utc_on_invalid_timezone():
    start_ai_request_context(request_id="req-2", timezone="Not/A_Real_Zone")
    line = _reference_date_line()
    assert "UTC" in line


def test_reference_date_line_falls_back_to_utc_when_no_context():
    # _reset_ai_request_context fixture (autouse) already cleared the
    # ambient context before this test runs.
    line = _reference_date_line()
    assert "UTC" in line


@pytest.mark.asyncio
async def test_generate_completion_final_call_includes_both_lines(monkeypatch):
    captured = {}

    async def fake_acompletion(**params):
        captured["messages"] = params.get("messages")
        import types

        msg = types.SimpleNamespace(content="answer", text="answer")
        choice = types.SimpleNamespace(message=msg)
        return types.SimpleNamespace(choices=[choice], usage=None)

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)

    service = _make_service()
    await service.generate_completion(
        prompt="hello",
        system_context="You are Aicser, a BI assistant.",
        model_id="fake_primary",
        timeout=2.0,
        num_retries=0,
    )

    sent_system = captured["messages"][0]["content"]
    assert _CONFIDENTIALITY_LINE.strip() in sent_system
    assert _REFERENCE_DATE_MARKER in sent_system
    assert sent_system.startswith("You are Aicser, a BI assistant.")
