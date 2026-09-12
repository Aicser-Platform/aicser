"""Regression tests for the LLM-call heartbeat (fix for the silent-empty-
response bug: a slow/retried single blocking LLM call produced zero SSE
bytes for 200+s, which very likely let an idle-connection timeout tear the
stream down before the eventually-correct graceful error message could
reach the client -- live-reproduced in this session's own sandbox, whose
Azure credentials are broken).
"""

import asyncio
import re
from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.services import litellm_service as svc


@pytest.mark.asyncio
async def test_heartbeat_never_fires_for_a_fast_call():
    """The overwhelming majority of real calls complete in well under the
    heartbeat interval -- must add no visible behavior for them."""
    events = []

    async def _fake_emit(message, **kwargs):
        events.append(message)

    async def _fast_call(**kwargs):
        await asyncio.sleep(0.01)
        return "fast result"

    with patch("ee.modules.ai.kernel.stream_events.emit_heartbeat", new=_fake_emit), patch.object(
        svc, "_litellm_acompletion", new=_fast_call
    ), patch.object(svc, "_HEARTBEAT_INTERVAL_SECONDS", 5.0):
        result = await svc._completion_with_heartbeat({"model": "test-model"})

    assert result == "fast result"
    assert events == []


@pytest.mark.asyncio
async def test_heartbeat_fires_periodically_during_a_slow_call():
    events = []

    async def _fake_emit(message, **kwargs):
        events.append(message)

    async def _slow_call(**kwargs):
        await asyncio.sleep(0.25)
        return "slow result"

    with patch("ee.modules.ai.kernel.stream_events.emit_heartbeat", new=_fake_emit), patch.object(
        svc, "_litellm_acompletion", new=_slow_call
    ), patch.object(svc, "_HEARTBEAT_INTERVAL_SECONDS", 0.05):
        result = await svc._completion_with_heartbeat({"model": "azure/glm-5.3"})

    assert result == "slow result"
    # ~0.25s / 0.05s interval => several heartbeats, not just one
    assert len(events) >= 3
    # Regression guard: the model/provider identifier must never reach the
    # user-facing heartbeat text (infra detail, same principle as the
    # activity-inbox error classifier) — it must say "Still working", not
    # "Still working with azure/glm-5.3".
    assert "azure/glm-5.3" not in events[0]
    assert "still working" in events[0].lower()
    assert not re.search(r"\(\d+\s*s\)", events[0])


@pytest.mark.asyncio
async def test_heartbeat_task_is_cancelled_after_call_completes():
    """The heartbeat must not keep running (or leak a task) once the real
    call is done -- confirmed by waiting past several intervals after
    completion and seeing no further emits."""
    events = []

    async def _fake_emit(message, **kwargs):
        events.append(message)

    async def _quick_call(**kwargs):
        await asyncio.sleep(0.03)
        return "done"

    with patch("ee.modules.ai.kernel.stream_events.emit_heartbeat", new=_fake_emit), patch.object(
        svc, "_litellm_acompletion", new=_quick_call
    ), patch.object(svc, "_HEARTBEAT_INTERVAL_SECONDS", 0.02):
        await svc._completion_with_heartbeat({"model": "test-model"})
        count_at_completion = len(events)
        await asyncio.sleep(0.1)  # several more intervals' worth of time

    assert len(events) == count_at_completion  # no further heartbeats after completion


@pytest.mark.asyncio
async def test_heartbeat_propagates_the_real_exception():
    async def _fake_emit(message, **kwargs):
        pass

    async def _failing_call(**kwargs):
        await asyncio.sleep(0.01)
        raise RuntimeError("provider exploded")

    with patch("ee.modules.ai.kernel.stream_events.emit_heartbeat", new=_fake_emit), patch.object(
        svc, "_litellm_acompletion", new=_failing_call
    ), patch.object(svc, "_HEARTBEAT_INTERVAL_SECONDS", 5.0):
        with pytest.raises(RuntimeError, match="provider exploded"):
            await svc._completion_with_heartbeat({"model": "test-model"})


@pytest.mark.asyncio
async def test_a_broken_emit_heartbeat_never_breaks_the_actual_llm_call():
    """A heartbeat failure (e.g. no active stream queue, or a transient bug
    in the emit path) must never affect the real result -- this is
    best-effort UX, not part of the LLM call's correctness contract."""

    async def _broken_emit(message, **kwargs):
        raise RuntimeError("emit blew up")

    async def _slow_call(**kwargs):
        await asyncio.sleep(0.15)
        return "still works"

    with patch("ee.modules.ai.kernel.stream_events.emit_heartbeat", new=_broken_emit), patch.object(
        svc, "_litellm_acompletion", new=_slow_call
    ), patch.object(svc, "_HEARTBEAT_INTERVAL_SECONDS", 0.03):
        result = await svc._completion_with_heartbeat({"model": "test-model"})

    assert result == "still works"


@pytest.mark.asyncio
async def test_emit_heartbeat_is_a_progress_event_not_a_new_unhandled_type():
    """Regression guard for the actual fix decision: must reuse the
    frontend's already-wired 'progress' event type, not a 'heartbeat' type
    the client has no handler for."""
    from ee.modules.ai.kernel import stream_events

    captured = []

    class _FakeQueue:
        async def put(self, item):
            captured.append(item)

    with patch("ee.modules.ai.kernel.stream_events.get_stream_queue", return_value=_FakeQueue()):
        await stream_events.emit_heartbeat("Still working…")

    assert len(captured) == 1
    event_kind, payload = captured[0]
    assert event_kind == "progress"
    assert payload["type"] == "progress"
    assert payload["message"] == "Still working…"


@pytest.mark.asyncio
async def test_emit_heartbeat_is_a_noop_without_an_active_stream_queue():
    from ee.modules.ai.kernel import stream_events

    with patch("ee.modules.ai.kernel.stream_events.get_stream_queue", return_value=None):
        await stream_events.emit_heartbeat("Still working…")  # must not raise
