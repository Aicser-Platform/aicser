"""Ephemeral dashboard build progress — shared by chat SSE and Studio SSE."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Dict, List, Optional, Set

logger = logging.getLogger(__name__)

BUILD_SESSION_PREFIX = "dashboard_build:"
BUILD_CHANNEL_PREFIX = "dashboard_build_channel:"
BUILD_SESSION_TTL = 3600
_memory_sessions: Dict[str, Dict[str, Any]] = {}
_subscribers: Dict[str, Set[asyncio.Queue]] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _session_key(dashboard_id: str) -> str:
    return f"{BUILD_SESSION_PREFIX}{dashboard_id}"


def _get_cache():
    try:
        from src.core.cache import cache

        return cache
    except Exception:
        return None


def _channel_key(dashboard_id: str) -> str:
    return f"{BUILD_CHANNEL_PREFIX}{dashboard_id}"


def session_to_progress_event(session: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Canonical SSE payload — matches chat analyze stream event shape."""
    if not session:
        return {
            "type": "dashboard_build_progress",
            "event_type": "dashboard_build_progress",
            "active": False,
        }
    status = session.get("status")
    return {
        "type": "dashboard_build_progress",
        "event_type": "dashboard_build_progress",
        "active": status == "building",
        **session,
    }


def _broadcast_build_event(dashboard_id: str, event: Dict[str, Any]) -> None:
    """Notify in-process subscribers and Redis pub/sub peers."""
    subs = _subscribers.get(str(dashboard_id), set())
    for queue in list(subs):
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            logger.debug("Build subscriber queue full for dashboard %s", dashboard_id)

    cache = _get_cache()
    if cache and cache.redis_client:
        try:
            from src.core.cache import _json_serial_default

            cache.redis_client.publish(
                _channel_key(str(dashboard_id)),
                json.dumps(event, default=_json_serial_default),
            )
        except Exception as exc:
            logger.debug("Redis publish skipped for dashboard build %s: %s", dashboard_id, exc)


async def register_build_subscriber(dashboard_id: str) -> asyncio.Queue:
    queue: asyncio.Queue = asyncio.Queue(maxsize=64)
    _subscribers.setdefault(str(dashboard_id), set()).add(queue)
    return queue


async def unregister_build_subscriber(dashboard_id: str, queue: asyncio.Queue) -> None:
    subs = _subscribers.get(str(dashboard_id))
    if subs:
        subs.discard(queue)
        if not subs:
            _subscribers.pop(str(dashboard_id), None)


def _format_sse(event: Dict[str, Any]) -> str:
    return f"data: {json.dumps(event, default=str)}\n\n"


def get_build_session(dashboard_id: str) -> Optional[Dict[str, Any]]:
    """Return live build session for a dashboard, or None if not building."""
    key = _session_key(str(dashboard_id))
    cache = _get_cache()
    if cache:
        session = cache.get(key)
        if session:
            return session
    return _memory_sessions.get(key)


def upsert_build_session(dashboard_id: str, patch: Dict[str, Any]) -> Dict[str, Any]:
    """Merge patch into the build session and persist with TTL."""
    key = _session_key(str(dashboard_id))
    existing = get_build_session(dashboard_id) or {
        "dashboard_id": str(dashboard_id),
        "status": "building",
        "stage": "init",
        "message": "",
        "percent": 0,
        "target_widgets": 0,
        "widgets_ready": [],
        "sections": [],
        "started_at": _now_iso(),
    }
    merged: Dict[str, Any] = {
        **existing,
        **{k: v for k, v in patch.items() if v is not None},
        "dashboard_id": str(dashboard_id),
        "updated_at": _now_iso(),
    }
    cache = _get_cache()
    if cache:
        cache.set(key, merged, ttl=BUILD_SESSION_TTL)
    _memory_sessions[key] = merged
    _broadcast_build_event(str(dashboard_id), session_to_progress_event(merged))
    return merged


def append_widget_ready(dashboard_id: str, widget: Dict[str, Any]) -> Dict[str, Any]:
    """Append or replace a widget entry in the build session."""
    session = get_build_session(dashboard_id) or upsert_build_session(dashboard_id, {})
    ready: List[Dict[str, Any]] = list(session.get("widgets_ready") or [])
    idx = widget.get("index", len(ready))
    ready = [w for w in ready if w.get("index") != idx]
    ready.append(widget)
    ready.sort(key=lambda w: int(w.get("index", 0)))
    ready_count = len([w for w in ready if w.get("status") != "failed"])
    target = int(session.get("target_widgets") or 0)
    percent = session.get("percent") or 0
    if target > 0:
        percent = min(95.0, 20.0 + (ready_count / target) * 70.0)
    merged = upsert_build_session(
        dashboard_id,
        {
            "widgets_ready": ready,
            "percent": percent,
            "status": "building",
        },
    )
    event_type = "dashboard_widget_failed" if widget.get("status") == "failed" else "dashboard_widget_ready"
    _broadcast_build_event(
        str(dashboard_id),
        {
            "type": event_type,
            "event_type": event_type,
            "dashboard_id": str(dashboard_id),
            "widget_index": widget.get("index"),
            "title": widget.get("title"),
            "chart_type": widget.get("chart_type"),
            "status": widget.get("status", "ready"),
            "error": widget.get("error"),
            "chart_id": widget.get("chart_id"),
        },
    )
    return merged


def finalize_build_session(dashboard_id: str, *, status: str, **extra: Any) -> Dict[str, Any]:
    """Mark build complete or failed."""
    patch: Dict[str, Any] = {"status": status, **extra}
    if status == "complete":
        patch.setdefault("percent", 100.0)
    return upsert_build_session(dashboard_id, patch)


def clear_build_session(dashboard_id: str) -> None:
    """Remove build session after rollback or expiry."""
    key = _session_key(str(dashboard_id))
    cache = _get_cache()
    if cache:
        try:
            cache.delete(key)
        except Exception:
            pass
    _memory_sessions.pop(key, None)
    _broadcast_build_event(
        str(dashboard_id),
        {
            "type": "dashboard_build_progress",
            "event_type": "dashboard_build_progress",
            "active": False,
            "dashboard_id": str(dashboard_id),
            "status": "cleared",
        },
    )


async def sync_build_progress(
    dashboard_id: str,
    *,
    stage: str,
    message: str,
    percent: float,
    status: str = "building",
    **extra: Any,
) -> None:
    """Persist progress snapshot for Studio polling."""
    if not dashboard_id:
        return
    upsert_build_session(
        dashboard_id,
        {
            "stage": stage,
            "message": message,
            "percent": percent,
            "status": status,
            **extra,
        },
    )


async def emit_dashboard_build_sse(
    event_type: str,
    *,
    dashboard_id: str,
    workflow_state: Optional[Dict[str, Any]] = None,
    **payload: Any,
) -> None:
    """Emit dashboard build SSE event and mirror into workflow_state."""
    event = {
        "event_type": event_type,
        "type": event_type,
        "dashboard_id": str(dashboard_id),
        **payload,
    }
    if workflow_state is not None:
        build = dict(workflow_state.get("dashboard_build") or {})
        build.update(event)
        workflow_state["dashboard_build"] = build
        workflow_state["dashboard_build_id"] = str(dashboard_id)

    try:
        from src.modules.ai.utils.stream_queue_context import get_stream_queue

        queue = get_stream_queue()
        if queue:
            await queue.put(event)
    except Exception:
        pass

    try:
        _broadcast_build_event(str(dashboard_id), event)
    except Exception:
        pass


async def iter_build_progress_sse(dashboard_id: str) -> AsyncIterator[str]:
    """SSE stream for Studio — same event vocabulary as chat analyze."""
    dash_id = str(dashboard_id)
    queue = await register_build_subscriber(dash_id)
    pubsub = None
    redis_task: Optional[asyncio.Task] = None

    async def _listen_redis() -> None:
        cache = _get_cache()
        if not cache or not cache.redis_client:
            return
        nonlocal pubsub
        try:
            pubsub = cache.redis_client.pubsub(ignore_subscribe_messages=True)
            pubsub.subscribe(_channel_key(dash_id))
            while True:
                message = await asyncio.to_thread(pubsub.get_message, timeout=1.0)
                if not message or message.get("type") != "message":
                    continue
                data = message.get("data")
                if isinstance(data, bytes):
                    data = data.decode("utf-8", errors="replace")
                if isinstance(data, str):
                    try:
                        event = json.loads(data)
                        await queue.put(event)
                    except json.JSONDecodeError:
                        pass
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.debug("Redis build progress listener stopped: %s", exc)
        finally:
            if pubsub:
                try:
                    pubsub.unsubscribe(_channel_key(dash_id))
                    pubsub.close()
                except Exception:
                    pass

    try:
        session = get_build_session(dash_id)
        yield _format_sse(
            session_to_progress_event(session)
            if session
            else {
                "type": "dashboard_build_progress",
                "event_type": "dashboard_build_progress",
                "active": False,
                "dashboard_id": dash_id,
            }
        )

        if not session or session.get("status") not in ("building",):
            return

        redis_task = asyncio.create_task(_listen_redis())

        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=25.0)
            except asyncio.TimeoutError:
                session = get_build_session(dash_id)
                if not session or session.get("status") not in ("building",):
                    if session:
                        yield _format_sse(session_to_progress_event(session))
                    break
                yield ": heartbeat\n\n"
                continue

            yield _format_sse(event)
            status = event.get("status")
            event_type = event.get("event_type") or event.get("type")
            if status in ("complete", "failed", "cleared"):
                break
            if event_type == "dashboard_build_progress" and status not in (None, "building"):
                break
    finally:
        if redis_task:
            redis_task.cancel()
            try:
                await redis_task
            except asyncio.CancelledError:
                pass
        await unregister_build_subscriber(dash_id, queue)
