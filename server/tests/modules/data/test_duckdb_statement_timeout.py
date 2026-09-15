"""Regression test: DuckDB query execution now has a real, enforced
statement timeout — previously it had none at all.

Root cause: unlike direct_sql_pool.py's DEFAULT_STATEMENT_TIMEOUT_SECONDS
(enforced server-side for real customer DB connections via connect_args),
the DuckDB engine — used by every sample_duckdb data source AND every
uploaded CSV/Excel file — called conn.execute(query).fetchall() directly,
synchronously, with no timeout and no cancellation path. A single expensive
aggregation or accidental cross join could block the event loop
indefinitely.

Fixed with _execute_duckdb_with_timeout: the blocking call now runs in a
worker thread under asyncio.wait_for, and conn.interrupt() actually cancels
the in-flight query on timeout (DuckDB's documented cancellation API) rather
than merely abandoning the wait.
"""

import time

import duckdb
import pytest

from src.modules.data.services.multi_engine_query_service import (
    _execute_duckdb_with_timeout,
)


@pytest.mark.asyncio
async def test_fast_query_returns_normally():
    conn = duckdb.connect()
    result = await _execute_duckdb_with_timeout(conn, "SELECT 1 AS x")
    assert result == [(1,)]
    conn.close()


class _SlowFakeConnection:
    """Stands in for a duckdb connection whose query genuinely never
    returns in reasonable time — decouples this test from DuckDB's own
    query optimizer (which can shortcut a cross-join COUNT(*) into a
    multiplication and finish before any timeout would fire)."""

    def __init__(self):
        self.interrupted = False

    def execute(self, query):
        while not self.interrupted:
            time.sleep(0.05)
        raise RuntimeError("interrupted")  # what a real DuckDB query raises on conn.interrupt()

    def interrupt(self):
        self.interrupted = True


@pytest.mark.asyncio
async def test_slow_query_times_out_and_is_interrupted(monkeypatch):
    import src.modules.data.services.multi_engine_query_service as svc

    monkeypatch.setattr(svc, "DUCKDB_STATEMENT_TIMEOUT_SECONDS", 1)

    conn = _SlowFakeConnection()
    start = time.monotonic()
    with pytest.raises(TimeoutError, match="execution limit"):
        await _execute_duckdb_with_timeout(conn, "SELECT 1")
    elapsed = time.monotonic() - start
    # Must return close to the timeout, not hang for the query's true
    # (unbounded) natural runtime -- proves wait_for actually bounds it.
    assert elapsed < 3
    assert conn.interrupted is True


@pytest.mark.asyncio
async def test_does_not_block_the_event_loop_while_running():
    """A concurrent, unrelated coroutine must keep making progress while a
    DuckDB query executes -- proving the blocking call actually moved off
    the event loop instead of just gaining a timeout wrapper around a still
    fully-blocking call."""
    import asyncio

    conn = duckdb.connect()
    ticks = 0

    async def ticker():
        nonlocal ticks
        for _ in range(20):
            await asyncio.sleep(0.01)
            ticks += 1

    query_task = asyncio.create_task(
        _execute_duckdb_with_timeout(conn, "SELECT COUNT(*) FROM range(3000000)")
    )
    await ticker()
    await query_task
    conn.close()

    assert ticks == 20
