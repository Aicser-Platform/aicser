"""Shared sync SQLAlchemy engine pool for Direct SQL chart/query execution."""

from __future__ import annotations

import hashlib
import logging
import os
import threading
from typing import Any, Dict

import sqlalchemy as sa
from sqlalchemy.pool import QueuePool

logger = logging.getLogger(__name__)

_pool_lock = threading.Lock()
_engines: Dict[str, sa.engine.Engine] = {}

DEFAULT_POOL_SIZE = int(os.getenv("DIRECT_SQL_POOL_SIZE", "5"))
DEFAULT_MAX_OVERFLOW = int(os.getenv("DIRECT_SQL_POOL_MAX_OVERFLOW", "10"))
DEFAULT_POOL_RECYCLE = int(os.getenv("DIRECT_SQL_POOL_RECYCLE", "3600"))


def _pool_key(data_source: Dict[str, Any], conn_uri: str) -> str:
    ds_id = data_source.get("id") or data_source.get("data_source_id") or ""
    if ds_id:
        return f"ds:{ds_id}"
    return f"uri:{hashlib.sha256(conn_uri.encode()).hexdigest()[:32]}"


def get_sync_engine(data_source: Dict[str, Any], conn_uri: str) -> sa.engine.Engine:
    """Return a pooled sync engine for the data source (reused across chart refreshes)."""
    key = _pool_key(data_source, conn_uri)
    with _pool_lock:
        existing = _engines.get(key)
        if existing is not None:
            return existing

        engine = sa.create_engine(
            conn_uri,
            poolclass=QueuePool,
            pool_size=DEFAULT_POOL_SIZE,
            max_overflow=DEFAULT_MAX_OVERFLOW,
            pool_pre_ping=True,
            pool_recycle=DEFAULT_POOL_RECYCLE,
        )
        _engines[key] = engine
        logger.info("Created Direct SQL connection pool (key=%s, pool_size=%s)", key, DEFAULT_POOL_SIZE)
        return engine


def dispose_engine_for_data_source(data_source_id: str) -> None:
    """Drop cached pool when a data source is removed or credentials change."""
    key = f"ds:{data_source_id}"
    with _pool_lock:
        engine = _engines.pop(key, None)
    if engine is not None:
        try:
            engine.dispose()
        except Exception:
            pass
        logger.info("Disposed Direct SQL connection pool (key=%s)", key)


def clear_all_pools() -> None:
    """Test helper — dispose every cached engine."""
    with _pool_lock:
        engines = list(_engines.values())
        _engines.clear()
    for engine in engines:
        try:
            engine.dispose()
        except Exception:
            pass
