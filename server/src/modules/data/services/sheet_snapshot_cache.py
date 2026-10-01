"""Local snapshots of Google Sheet CSV exports.

Every chat question on a Sheet used to re-download the whole export (~1 s each, and
several queries per question). Snapshots are reused for a short freshness window
(GOOGLE_SHEETS_SNAPSHOT_TTL_S, default 60 s), downloaded once per key even under
concurrency, written atomically, and — if Google is unreachable — a recent snapshot
(GOOGLE_SHEETS_SNAPSHOT_MAX_STALE_S, default 24 h) is served rather than failing.
Keys include the data source id, so tenants never share a snapshot.
"""

import asyncio
import hashlib
import logging
import os
import time
from typing import Awaitable, Callable, Dict

logger = logging.getLogger(__name__)

_locks: Dict[str, asyncio.Lock] = {}


def _env_seconds(name: str, default: float) -> float:
    try:
        return max(0.0, float(os.getenv(name, str(default)) or default))
    except ValueError:
        return default


def _snapshot_path(data_source_id: str, sheet_id: str, gid: str) -> str:
    from src.modules.data.services.upload_datasource_storage_service import _get_cache_dir

    key = hashlib.sha256(f"gsheet:{data_source_id}:{sheet_id}:{gid}".encode()).hexdigest()
    return os.path.join(_get_cache_dir(), f"{key}.csv")


def _age(path: str) -> float:
    try:
        if os.path.getsize(path) > 0:
            return time.time() - os.path.getmtime(path)
    except OSError:
        pass
    return float("inf")


async def get_sheet_snapshot(
    data_source_id: str,
    sheet_id: str,
    gid: str,
    fetch_csv: Callable[[], Awaitable[str]],
) -> str:
    """Return a local CSV path for this Sheet tab, downloading only when stale."""
    ttl = _env_seconds("GOOGLE_SHEETS_SNAPSHOT_TTL_S", 60)
    max_stale = _env_seconds("GOOGLE_SHEETS_SNAPSHOT_MAX_STALE_S", 86400)
    path = _snapshot_path(str(data_source_id or ""), sheet_id, gid)
    if _age(path) < ttl:
        return path
    lock = _locks.setdefault(path, asyncio.Lock())
    async with lock:
        if _age(path) < ttl:  # another request refreshed it while we waited
            return path
        try:
            body = await fetch_csv()
            if not body or not body.strip():
                raise ValueError("Google Sheet export returned empty content")
            tmp = f"{path}.{os.getpid()}.tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                fh.write(body)
            os.replace(tmp, path)
            return path
        except Exception as exc:
            if _age(path) < max_stale:
                logger.warning("Google Sheet refresh failed (%s); serving snapshot %.0fs old", exc, _age(path))
                return path
            raise
