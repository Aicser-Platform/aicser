"""Logs what the server is doing when its event loop stalls.

One blocking call on the loop freezes every request, health checks included, and leaves nothing in
the logs. A thread outside the loop notices the missing heartbeat and logs the main thread's stack.
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
import threading
import time
import traceback

logger = logging.getLogger(__name__)

STALL_AFTER_S = float(os.getenv("AISER_LOOP_STALL_WARN_S", "1") or 0)
BEAT_S = 0.2
STACK_LINES = 14


def _stack(thread_id: int) -> str:
    frame = sys._current_frames().get(thread_id)
    if not frame:
        return "(no frame)"
    frames = traceback.format_stack(frame)
    ours = [f for f in frames[:-STACK_LINES] if "/app/src/" in f or "/app/ee/" in f]  # who started it
    return "".join(ours[-3:] + frames[-STACK_LINES:])


def start_loop_watchdog() -> None:
    """Call once from inside the running loop. Off when AISER_LOOP_STALL_WARN_S is 0."""
    if STALL_AFTER_S <= 0:
        return
    loop = asyncio.get_running_loop()
    loop_thread = threading.get_ident()
    last_beat = [time.monotonic()]

    def beat() -> None:
        last_beat[0] = time.monotonic()
        loop.call_later(BEAT_S, beat)

    def watch() -> None:
        reported = 0.0
        while not loop.is_closed():
            time.sleep(BEAT_S)
            seen = last_beat[0]
            if time.monotonic() - seen > STALL_AFTER_S and seen != reported:
                reported = seen  # once per stall
                logger.warning("Event loop stalled for over %.1fs at:\n%s", STALL_AFTER_S, _stack(loop_thread))

    beat()
    threading.Thread(target=watch, name="loop-watchdog", daemon=True).start()
