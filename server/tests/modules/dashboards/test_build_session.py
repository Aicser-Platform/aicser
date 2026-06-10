"""Tests for dashboard build session persistence."""

import asyncio

import pytest

from src.modules.dashboards import build_session as bs


def test_upsert_and_get_build_session():
    bs.clear_build_session("dash-1")
    session = bs.upsert_build_session(
        "dash-1",
        {
            "stage": "dashboard_create_shell",
            "message": "Creating shell…",
            "percent": 15.0,
            "target_widgets": 6,
        },
    )
    assert session["dashboard_id"] == "dash-1"
    assert session["target_widgets"] == 6

    loaded = bs.get_build_session("dash-1")
    assert loaded is not None
    assert loaded["stage"] == "dashboard_create_shell"


def test_append_widget_ready_updates_percent():
    bs.clear_build_session("dash-2")
    bs.upsert_build_session("dash-2", {"target_widgets": 4})
    bs.append_widget_ready(
        "dash-2",
        {"index": 0, "title": "Revenue", "chart_type": "stat", "status": "ready"},
    )
    session = bs.get_build_session("dash-2")
    assert session is not None
    assert len(session["widgets_ready"]) == 1
    assert session["percent"] > 20.0


def test_finalize_and_clear_build_session():
    bs.clear_build_session("dash-3")
    bs.upsert_build_session("dash-3", {"target_widgets": 2})
    bs.finalize_build_session("dash-3", status="complete", widget_count=2)
    session = bs.get_build_session("dash-3")
    assert session is not None
    assert session["status"] == "complete"
    assert session["percent"] == 100.0

    bs.clear_build_session("dash-3")
    assert bs.get_build_session("dash-3") is None


def test_session_to_progress_event_shape():
    from src.modules.dashboards.build_session import session_to_progress_event

    event = session_to_progress_event(
        {
            "dashboard_id": "d-1",
            "status": "building",
            "stage": "dashboard_create_widgets",
            "percent": 42.0,
        }
    )
    assert event["type"] == "dashboard_build_progress"
    assert event["event_type"] == "dashboard_build_progress"
    assert event["active"] is True
    assert event["dashboard_id"] == "d-1"


@pytest.mark.asyncio
async def test_build_subscriber_receives_broadcast():
    from src.modules.dashboards.build_session import (
        clear_build_session,
        register_build_subscriber,
        unregister_build_subscriber,
        upsert_build_session,
    )

    bs_id = "dash-sub-1"
    clear_build_session(bs_id)
    queue = await register_build_subscriber(bs_id)
    try:
        upsert_build_session(bs_id, {"message": "Creating widgets…", "status": "building"})
        event = await asyncio.wait_for(queue.get(), timeout=1.0)
        assert event["event_type"] == "dashboard_build_progress"
        assert event["dashboard_id"] == bs_id
    finally:
        await unregister_build_subscriber(bs_id, queue)
        clear_build_session(bs_id)

