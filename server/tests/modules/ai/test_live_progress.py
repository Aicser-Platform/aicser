"""Live progress events must reach the stream queue during a long node."""

import asyncio

import pytest

from ee.modules.ai.utils.live_progress import emit_live_progress
from ee.modules.ai.utils.stream_queue_context import set_stream_queue


@pytest.mark.asyncio
async def test_emit_live_progress_is_a_progress_event():
    queue: asyncio.Queue = asyncio.Queue()
    set_stream_queue(queue)
    try:
        await emit_live_progress(
            "Building your chart and insights…",
            percentage=72.0,
            stage="analytics_render",
            node="analytics_render",
        )
        kind, payload = await queue.get()
        assert kind == "progress"
        assert payload["type"] == "progress"
        assert payload["message"] == "Building your chart and insights…"
        assert payload["percentage"] == 72.0
        assert payload["stage"] == "analytics_render"
    finally:
        set_stream_queue(None)


@pytest.mark.asyncio
async def test_emit_chart_ready_requires_series():
    from ee.modules.ai.utils.live_progress import emit_chart_ready

    queue: asyncio.Queue = asyncio.Queue()
    set_stream_queue(queue)
    try:
        await emit_chart_ready({"title": {"text": "empty"}})
        assert queue.empty()
        await emit_chart_ready({"series": [{"type": "bar", "data": [1, 2]}]})
        kind, payload = await queue.get()
        assert kind == "chart_ready"
        assert payload["type"] == "chart_ready"
        assert payload["echarts_config"]["series"]
        assert payload["partial_results"]["echarts_config"]["series"]
    finally:
        set_stream_queue(None)


@pytest.mark.asyncio
async def test_emit_query_result_ready_caps_preview():
    from ee.modules.ai.utils.live_progress import emit_query_result_ready

    queue: asyncio.Queue = asyncio.Queue()
    set_stream_queue(queue)
    try:
        rows = [{"i": i} for i in range(120)]
        await emit_query_result_ready(rows, columns=["i"], row_count=120, sql_query="SELECT i")
        kind, payload = await queue.get()
        assert kind == "query_result_ready"
        assert payload["type"] == "query_result_ready"
        assert len(payload["query_result"]) == 80
        assert payload["query_result_row_count"] == 120
        assert payload["query_result_truncated"] is True
        assert payload["partial_results"]["query_result"][0] == {"i": 0}
        assert payload["sql_query"] == "SELECT i"
    finally:
        set_stream_queue(None)
