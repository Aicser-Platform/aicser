"""In-flight run snapshots survive disconnect and can be cancelled."""

import asyncio

import pytest

from ee.modules.ai.services import inflight_run_service as inflight_mod
from ee.modules.ai.services.inflight_run_service import InFlightRunService


@pytest.fixture(autouse=True)
def _clear_inflight_runs():
    inflight_mod._runs.clear()
    yield
    inflight_mod._runs.clear()


@pytest.mark.asyncio
async def test_inflight_snapshot_and_cancel():
    svc = InFlightRunService()
    cid = "conv-snapshot"
    await svc.start_run(
        conversation_id=cid,
        trace_id="abc123",
        user_id="user-1",
        query="forecast loans",
    )
    await svc.publish_event(
        cid,
        {"type": "progress", "percentage": 40, "message": "Building chart…", "stage": "analytics_render"},
    )
    snap = svc.get_snapshot(cid)
    assert snap is not None
    assert snap["status"] == "running"
    assert snap["progress"]["percentage"] == 40
    assert svc.owned_by(snap, "user-1") is True
    assert svc.owned_by(snap, "other") is False

    q = await svc.subscribe(cid)
    ok = await svc.cancel(cid, user_id="user-1")
    assert ok is True
    event = await asyncio.wait_for(q.get(), timeout=1)
    assert event.get("cancelled") is True
    svc.unsubscribe(cid, q)


@pytest.mark.asyncio
async def test_inflight_complete_emits_to_watchers():
    svc = InFlightRunService()
    cid = "conv-complete"
    await svc.start_run(
        conversation_id=cid,
        trace_id="t2",
        user_id="user-1",
        query="q",
    )
    q = await svc.subscribe(cid)
    await svc.mark_complete(
        cid,
        {"type": "complete", "executive_summary": "Forecast ready", "workflow_complete": True},
    )
    event = await asyncio.wait_for(q.get(), timeout=1)
    assert event.get("type") == "complete" or event.get("workflow_complete")
    svc.unsubscribe(cid, q)
