"""Voice input: "nothing was said" and "transcription isn't working" must not look the same.

Both used to come back as an empty transcript, so a dead AI key showed "Didn't catch that, try
closer to the microphone". Now silence is "" and a failure raises (503 from /ai/transcribe).
"""

from types import SimpleNamespace

import pytest

from ee.modules.ai.services import multimodal_ingestion as MI

WAV = b"RIFF0000WAVEfmt "


class _Service:
    available_models = {"openrouter_voice": {}}

    def __init__(self, result):
        self.result = result

    async def generate_completion(self, **_kwargs):
        return self.result


@pytest.fixture(autouse=True)
def _no_whisper(monkeypatch):
    """Whisper is the fallback; here it's unconfigured (no OpenAI key), as on most installs."""
    monkeypatch.delenv("AISER_STT_MODEL", raising=False)

    async def atranscription(**_kwargs):
        raise RuntimeError("Missing credentials")

    import litellm

    monkeypatch.setattr(litellm, "atranscription", atranscription)


@pytest.mark.asyncio
async def test_speech_is_transcribed():
    service = _Service({"success": True, "content": " top products by revenue "})
    assert await MI._transcribe_audio(WAV, "audio/wav", service, raise_on_failure=True) == "top products by revenue"


@pytest.mark.asyncio
async def test_silence_is_empty_not_a_failure():
    service = _Service({"success": True, "content": ""})
    assert await MI._transcribe_audio(WAV, "audio/wav", service, raise_on_failure=True) == ""


@pytest.mark.asyncio
async def test_unreachable_model_raises_for_voice_input():
    service = _Service({"success": False, "error": "User not found."})
    with pytest.raises(RuntimeError):
        await MI._transcribe_audio(WAV, "audio/wav", service, raise_on_failure=True)


@pytest.mark.asyncio
async def test_attachments_keep_the_quiet_empty_result():
    """Voice-note attachments still degrade to no transcript instead of failing the whole message."""
    service = _Service({"success": False, "error": "User not found."})
    assert await MI._transcribe_audio(WAV, "audio/wav", service) == ""


def _whisper(monkeypatch, handler):
    """Point AISER_STT_URL at a fake self-hosted Whisper answering with ``handler``."""
    import httpx

    monkeypatch.setenv("AISER_STT_URL", "http://whisper:8000/v1/")
    real = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))


@pytest.mark.asyncio
async def test_self_hosted_whisper_transcribes_without_an_ai_model(monkeypatch):
    import httpx

    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["body"] = request.content
        return httpx.Response(200, json={"text": " top products by revenue "})

    _whisper(monkeypatch, handler)
    never = _Service({"success": True, "content": "a cloud model must not be called"})
    text = await MI._transcribe_audio(WAV, "audio/wav", never, raise_on_failure=True)

    assert text == "top products by revenue"
    assert seen["url"] == "http://whisper:8000/v1/audio/transcriptions"
    assert WAV in seen["body"]


@pytest.mark.asyncio
async def test_self_hosted_whisper_down_never_falls_back_to_the_cloud(monkeypatch):
    import httpx

    _whisper(monkeypatch, lambda _request: httpx.Response(503))
    cloud = _Service({"success": True, "content": "leaked to the cloud"})
    with pytest.raises(httpx.HTTPStatusError):
        await MI._transcribe_audio(WAV, "audio/wav", cloud, raise_on_failure=True)
    assert await MI._transcribe_audio(WAV, "audio/wav", cloud) == ""


@pytest.mark.asyncio
async def test_live_preview_asks_whisper_for_its_fast_model(monkeypatch):
    import httpx

    models = []

    def handler(request: httpx.Request) -> httpx.Response:
        models.append(b'name="model"\r\n\r\npreview' in request.content)
        return httpx.Response(200, json={"text": "show me"})

    _whisper(monkeypatch, handler)
    assert await MI._transcribe_audio(WAV, "audio/wav", raise_on_failure=True, preview=True) == "show me"
    assert await MI._transcribe_audio(WAV, "audio/wav", raise_on_failure=True) == "show me"
    assert models == [True, False]


def _stub_pricing(monkeypatch):
    """Credit checks live in the EE pricing module; with no organization they aren't called."""
    import src.modules.pricing.usage_tracker as usage

    async def none(*_args, **_kwargs):
        return None

    monkeypatch.setattr(usage, "resolve_organization_id", none)
    monkeypatch.setattr(usage, "check_ai_credit_limit", none, raising=False)
    monkeypatch.setattr(usage, "track_ai_credits", none, raising=False)


def _upload():
    upload = SimpleNamespace(content_type="audio/wav")

    async def read(_n):
        return WAV

    upload.read = read
    return upload


@pytest.mark.asyncio
async def test_no_live_preview_without_self_hosted_whisper(monkeypatch):
    """On a paid cloud model every preview would be billed, so the app is told to wait for the end."""
    from ee.modules.ai import api_streaming

    monkeypatch.delenv("AISER_STT_URL", raising=False)

    async def must_not_run(*_args, **_kwargs):
        raise AssertionError("no model call for a preview")

    monkeypatch.setattr(MI, "_transcribe_audio", must_not_run)
    _stub_pricing(monkeypatch)
    out = await api_streaming.transcribe_voice(file=_upload(), preview=True, current_token={"sub": "u-1"})
    assert out == {"text": "", "live": False}


@pytest.mark.asyncio
async def test_transcribe_endpoint_says_unavailable(monkeypatch):
    from fastapi import HTTPException

    from ee.modules.ai import api_streaming

    async def failing(*_args, **_kwargs):
        raise RuntimeError("Missing credentials")

    monkeypatch.setattr(MI, "_transcribe_audio", failing)

    class _Session:
        async def __aenter__(self):
            return SimpleNamespace()

        async def __aexit__(self, *exc):
            return False

    async def no_org(*_args, **_kwargs):
        return None

    import src.modules.pricing.usage_tracker as usage

    monkeypatch.setattr(api_streaming, "async_session", lambda: _Session())
    monkeypatch.setattr(usage, "resolve_organization_id", no_org)
    # Credit checks live in the EE pricing module; with no organization they aren't called.
    monkeypatch.setattr(usage, "check_ai_credit_limit", no_org, raising=False)
    monkeypatch.setattr(usage, "track_ai_credits", no_org, raising=False)

    upload = SimpleNamespace(content_type="audio/wav")

    async def read(_n):
        return WAV

    upload.read = read
    with pytest.raises(HTTPException) as err:
        await api_streaming.transcribe_voice(file=upload, preview=False, current_token={"sub": "u-1"})
    assert err.value.status_code == 503
