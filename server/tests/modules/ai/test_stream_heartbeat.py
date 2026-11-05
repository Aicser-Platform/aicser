"""Ask AI stream: no repeated progress lines, and a visible "still working" line in long gaps."""

import asyncio
import json

import pytest

from ee.modules.ai import api_streaming as A


def _progress(msg):
    return "data: " + json.dumps({"type": "progress", "message": msg}) + "\n\n"


async def _collect(gen):
    return [x async for x in gen]


@pytest.mark.asyncio
async def test_identical_progress_lines_are_sent_once():
    async def source():
        for item in (_progress("Retrieving data…"), _progress("Retrieving data…"), _progress("Building chart…"),
                     "data: {\"type\": \"complete\"}\n\n"):
            yield item

    out = await _collect(A._with_sse_heartbeat(source()))
    assert [A._progress_message(x) for x in out] == ["Retrieving data…", "Building chart…", None]


@pytest.mark.asyncio
async def test_a_quiet_step_shows_that_it_is_still_working(monkeypatch):
    monkeypatch.setattr(A, "_VISIBLE_HEARTBEAT_SECONDS", 0.05)

    async def source():
        yield _progress("Writing the executive summary…")
        await asyncio.sleep(0.2)
        yield "data: {\"type\": \"complete\"}\n\n"

    out = await _collect(A._with_sse_heartbeat(source(), interval=0.05))
    still = [A._progress_message(x) for x in out if '"heartbeat": true' in x]
    assert still and still[0].startswith("Writing the executive summary… · ")
    assert out[-1].startswith("data: {\"type\": \"complete\"")
