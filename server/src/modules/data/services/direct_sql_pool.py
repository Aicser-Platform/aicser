"""Shared sync SQLAlchemy engine pool for Direct SQL chart/query execution."""

from __future__ import annotations

import hashlib
import logging
import os
import threading
from typing import Optional, Any, Dict

import sqlalchemy as sa
from sqlalchemy.pool import QueuePool

logger = logging.getLogger(__name__)

_pool_lock = threading.Lock()
_engines: Dict[str, sa.engine.Engine] = {}

DEFAULT_POOL_SIZE = int(os.getenv("DIRECT_SQL_POOL_SIZE", "5"))
DEFAULT_MAX_OVERFLOW = int(os.getenv("DIRECT_SQL_POOL_MAX_OVERFLOW", "10"))
DEFAULT_POOL_RECYCLE = int(os.getenv("DIRECT_SQL_POOL_RECYCLE", "3600"))
# AI-generated SQL is arbitrary, unparameterized text run against a customer's own
# database with no query-level LIMIT enforcement — a single crafted question (e.g.
# one that produces `pg_sleep(999999)` or a runaway cross join) previously ran with
# NO server-side statement timeout at all, tying up a DB connection and an app
# thread-pool slot indefinitely. This is a real, no-privilege-needed DoS vector on
# the platform's core feature, not a theoretical one.
DEFAULT_STATEMENT_TIMEOUT_SECONDS = int(os.getenv("DIRECT_SQL_STATEMENT_TIMEOUT_SECONDS", "30"))
# Cloud warehouses bill by data scanned; a timeout alone doesn't stop one query from
# scanning (and billing) a whole multi-TB table in 30 s. BigQuery refuses any query
# whose scan would exceed this *before* it runs. 0 disables the cap.
DEFAULT_MAX_BYTES_BILLED = int(os.getenv("AISER_QUERY_MAX_BYTES_BILLED", str(100 * 1024 ** 3)))
QUERY_TAG = os.getenv("AISER_QUERY_TAG", "aicser")


def _timeout_connect_args(conn_uri: str, timeout_seconds: int) -> Dict[str, Any]:
    """Best-effort, dialect-specific server-side statement timeout.

    Not every dialect SQLAlchemy supports here has a clean connect-time knob for
    this (SQL Server/pyodbc notably doesn't) — those fall back to the
    asyncio.wait_for() wrapper in DirectSQLEngine.execute as their only guard,
    which stops the *request* from hanging forever but can't force-kill an
    already-dispatched query on the DB side. Postgres/MySQL get the real,
    server-enforced timeout.
    """
    try:
        dialect = sa.engine.url.make_url(conn_uri).get_backend_name()
    except Exception:
        return {}
    if dialect.startswith("postgresql"):
        return {"options": f"-c statement_timeout={timeout_seconds * 1000}"}
    if dialect.startswith("mysql"):
        return {
            "connect_timeout": max(timeout_seconds, 30),
            "read_timeout": max(timeout_seconds, 90),
            "write_timeout": max(timeout_seconds, 90),
        }
    if dialect.startswith("redshift"):
        return {"options": f"-c statement_timeout={timeout_seconds * 1000}"}
    if dialect.startswith("snowflake"):
        # Server-enforced timeout, and a tag so warehouse admins can find Aicser's
        # queries (and their cost) in their own query history.
        return {"session_parameters": {"STATEMENT_TIMEOUT_IN_SECONDS": timeout_seconds, "QUERY_TAG": QUERY_TAG}}
    return {}


def _warehouse_engine_kwargs(conn_uri: str, timeout_seconds: int) -> Dict[str, Any]:
    """Engine-level (not connect-time) guards: BigQuery bytes-billed cap and job timeout."""
    try:
        dialect = sa.engine.url.make_url(conn_uri).get_backend_name()
    except Exception:
        return {}
    if dialect.startswith("bigquery"):
        try:
            from google.cloud.bigquery import QueryJobConfig  # type: ignore

            cfg = QueryJobConfig(labels={"source": QUERY_TAG})
            if DEFAULT_MAX_BYTES_BILLED > 0:
                cfg.maximum_bytes_billed = DEFAULT_MAX_BYTES_BILLED
            cfg.job_timeout_ms = timeout_seconds * 1000
            return {"default_query_job_config": cfg}
        except Exception as exc:
            logger.warning("BigQuery cost guard unavailable (%s) — queries run without a bytes cap", exc)
    return {}


def _pool_key(data_source: Dict[str, Any], conn_uri: str) -> str:
    ds_id = data_source.get("id") or data_source.get("data_source_id") or ""
    if ds_id:
        return f"ds:{ds_id}"
    return f"uri:{hashlib.sha256(conn_uri.encode()).hexdigest()[:32]}"


def get_sync_engine(
    data_source: Dict[str, Any], conn_uri: str, extra_engine_kwargs: Optional[Dict[str, Any]] = None
) -> sa.engine.Engine:
    """Return a pooled sync engine for the data source (reused across chart refreshes).
    ``extra_engine_kwargs`` carries settings a URL can't (e.g. a BigQuery service-account key)."""
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
            connect_args=_timeout_connect_args(conn_uri, DEFAULT_STATEMENT_TIMEOUT_SECONDS),
            **_warehouse_engine_kwargs(conn_uri, DEFAULT_STATEMENT_TIMEOUT_SECONDS),
            **(extra_engine_kwargs or {}),
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


def dispose_engine(data_source: Dict[str, Any], conn_uri: str) -> None:
    """Drop cached pool for a specific data source + URI pair."""
    key = _pool_key(data_source, conn_uri)
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
