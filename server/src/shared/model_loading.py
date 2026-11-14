"""One lock for loading local ML models (embedding, reranker).

Startup warm-ups and a user's first search can ask for the same model at once; this lock makes
them wait for one load instead of each loading the weights.
"""
import asyncio
import ctypes
import gc
import logging
import os
import threading
import time

logger = logging.getLogger(__name__)

MODEL_LOAD_LOCK = threading.RLock()


# Weights held for nobody cost ~500 MB per process; reloading takes seconds, so they leave when idle.
_last_used: dict = {}
_caches: dict = {}


def track(name: str, cache: dict) -> None:
    """Note that a model cache was used just now."""
    _caches[name] = cache
    _last_used[name] = time.monotonic()


def unload_idle(idle_seconds: float) -> int:
    freed = 0
    with MODEL_LOAD_LOCK:
        for name, used in list(_last_used.items()):
            if time.monotonic() - used >= idle_seconds and _caches.get(name):
                _caches[name].clear()
                freed += 1
    if freed:
        gc.collect()
        try:
            ctypes.CDLL("libc.so.6").malloc_trim(0)  # hand the freed memory back to the system
        except OSError:
            pass
        logger.info("Unloaded %d idle model cache(s)", freed)
    return freed


async def unload_idle_forever() -> None:
    minutes = float(os.getenv("AISER_MODEL_IDLE_MINUTES", "20") or 20)
    if minutes <= 0:
        return
    while True:
        await asyncio.sleep(60)
        await asyncio.to_thread(unload_idle, minutes * 60)
