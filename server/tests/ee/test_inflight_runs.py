"""An answer keeps going when its page goes away, and only its owner can follow or stop it."""

import asyncio
import json
import time

import pytest

from ee.modules.ai.services import inflight_run_service as svc
from ee.modules.ai.services.inflight_run_service import detach_stream, inflight_runs


class MemoryCache:
    redis_client = None

    def __init__(self):
        self.values = {}

    def set(self, key, value, ttl=None):
        self.values[key] = json.loads(json.dumps(value))

    def get(self, key):
        return self.values.get(key)


@pytest.fixture(autouse=True)
def cache(monkeypatch):
    memory = MemoryCache()
    monkeypatch.setattr(svc, "_cache", lambda: memory)
    yield memory
    svc._runs.clear()


def sse(**event):
    return f"data: {json.dumps(event)}\n\n"


def answer(done, gate):
    async def source():
        yield sse(type="progress", percentage=20, message="Reading", stage="plan")
        await gate.wait()
        yield sse(type="node_start", label="Writing SQL")
        done.append("saved")
        yield sse(type="complete", workflow_complete=True, message="Done")

    return source()


@pytest.mark.asyncio
async def test_the_answer_finishes_after_the_reader_leaves():
    done, gate = [], asyncio.Event()
    stream = detach_stream(answer(done, gate), conversation_id="c1", user_id="u1", query="sales?")
    await stream.__anext__()
    await stream.aclose()  # refresh or another page
    assert inflight_runs.is_running(inflight_runs.get_snapshot("c1"))
    gate.set()
    for _ in range(50):
        if done and not inflight_runs.is_running(inflight_runs.get_snapshot("c1")):
            break
        await asyncio.sleep(0.01)
    assert done == ["saved"]
    assert inflight_runs.get_snapshot("c1")["status"] == "complete"


@pytest.mark.asyncio
async def test_progress_is_readable_while_it_runs():
    gate = asyncio.Event()
    stream = detach_stream(answer([], gate), conversation_id="c2", user_id="u1", query="sales?")
    await stream.__anext__()
    snapshot = inflight_runs.get_snapshot("c2")
    assert snapshot["progress"]["message"] == "Reading"
    assert snapshot["user_id"] == "u1" and snapshot["query"] == "sales?"
    gate.set()
    await stream.aclose()


@pytest.mark.asyncio
async def test_a_watcher_sees_later_events():
    gate = asyncio.Event()
    stream = detach_stream(answer([], gate), conversation_id="c3", user_id="u1")
    await stream.__anext__()
    watcher = await inflight_runs.subscribe("c3")
    gate.set()
    event = await asyncio.wait_for(watcher.get(), 1)
    assert event["label"] == "Writing SQL"
    await stream.aclose()


@pytest.mark.asyncio
async def test_stop_ends_the_run():
    done, gate = [], asyncio.Event()
    stream = detach_stream(answer(done, gate), conversation_id="c4", user_id="u1")
    await stream.__anext__()
    assert await inflight_runs.cancel("c4", user_id="u1")
    gate.set()
    await asyncio.sleep(0.05)
    assert done == []
    assert inflight_runs.get_snapshot("c4")["status"] == "cancelled"
    await stream.aclose()


@pytest.mark.asyncio
async def test_only_the_owner_can_stop_or_see_it():
    gate = asyncio.Event()
    stream = detach_stream(answer([], gate), conversation_id="c5", user_id="u1")
    await stream.__anext__()
    assert not await inflight_runs.cancel("c5", user_id="u2")
    snapshot = inflight_runs.get_snapshot("c5")
    assert inflight_runs.owned_by(snapshot, "u1")
    assert not inflight_runs.owned_by(snapshot, "u2")
    assert not inflight_runs.owned_by({"status": "running"}, "u2")
    gate.set()
    await stream.aclose()


def test_a_run_that_lost_its_server_is_not_running():
    assert inflight_runs.is_running({"status": "running", "updated_at": time.time()})
    assert not inflight_runs.is_running({"status": "running", "updated_at": time.time() - svc.STALE_AFTER_S - 1})
    assert not inflight_runs.is_running({"status": "paused", "updated_at": time.time()})


@pytest.mark.asyncio
async def test_a_crash_ends_the_run_and_the_reader():
    async def source():
        yield sse(type="progress", message="Reading")
        raise RuntimeError("boom")

    chunks = [c async for c in detach_stream(source(), conversation_id="c6", user_id="u1")]
    assert len(chunks) == 1
    assert inflight_runs.get_snapshot("c6")["status"] == "error"


@pytest.mark.asyncio
async def test_without_a_conversation_it_is_a_plain_stream():
    async def source():
        yield "data: {}\n\n"

    assert [c async for c in detach_stream(source(), conversation_id=None, user_id="u1")] == ["data: {}\n\n"]
    assert svc._runs == {}
