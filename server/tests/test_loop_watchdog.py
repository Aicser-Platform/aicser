"""The watchdog names what blocked the event loop."""

import asyncio
import logging
import time

import pytest

from src.core import loop_watchdog as W


@pytest.mark.asyncio
async def test_a_blocked_loop_is_logged_with_its_stack(monkeypatch, caplog):
    monkeypatch.setattr(W, "STALL_AFTER_S", 0.1)
    monkeypatch.setattr(W, "BEAT_S", 0.02)
    W.start_loop_watchdog()
    with caplog.at_level(logging.WARNING, logger=W.logger.name):
        await asyncio.sleep(0.05)
        time.sleep(0.4)  # blocks the loop
        await asyncio.sleep(0.05)
    assert any("Event loop stalled" in r.message and "time.sleep" in r.message for r in caplog.records)
