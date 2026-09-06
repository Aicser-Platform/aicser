"""Tests for semantic_layer_db.py's column-classification cache methods
(get_column_classifications / upsert_column_classifications) -- the durable
storage backing column_semantic_classifier.py's LLM classification signal.
See semantic_column_classifications migration
(server/alembic/versions/2026_09_02_semantic_column_classifications.py) for
the table this reads/writes.

No real DB: async_session is faked with a minimal async-context-manager
session, following the same pattern as test_kpi_definition_caching.py and
test_reindex_stale_knowledge_chunks.py elsewhere in this test suite.
"""

import pytest

from ee.modules.ai.services.semantic_layer_db import semantic_layer_db


class _Result:
    def __init__(self, rows, keys):
        self._rows = rows
        self._keys = keys

    def fetchall(self):
        return self._rows

    def keys(self):
        return self._keys


class _FakeSession:
    """Records every execute() call's bound params, and whether commit() ran."""

    def __init__(self, result=None):
        self._result = result
        self.executed: list = []
        self.committed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def execute(self, stmt, params=None):
        self.executed.append({"sql": str(stmt), "params": params or {}})
        return self._result

    async def commit(self):
        self.committed = True


def _raising_async_session():
    raise RuntimeError("db unavailable")


# ---------------------------------------------------------------------------
# get_column_classifications
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_column_classifications_returns_rows_for_exact_fingerprint_match(monkeypatch):
    result = _Result(
        rows=[("orders", "amount", "metric", 0.9, "sum of order value")],
        keys=["table_name", "column_name", "classification", "confidence", "reasoning"],
    )
    fake_session = _FakeSession(result=result)
    monkeypatch.setattr("src.db.session.async_session", lambda: fake_session)

    rows = await semantic_layer_db.get_column_classifications("ds-1", "fp-abc")

    assert rows == [
        {
            "table_name": "orders",
            "column_name": "amount",
            "classification": "metric",
            "confidence": 0.9,
            "reasoning": "sum of order value",
        }
    ]
    # Reads are scoped by BOTH data_source_id and the live schema_fingerprint --
    # a stale row (old fingerprint) is invisible to this query, which is how
    # cache invalidation works with no explicit delete pass.
    assert fake_session.executed[0]["params"] == {"ds_id": "ds-1", "fp": "fp-abc"}


@pytest.mark.asyncio
async def test_get_column_classifications_fingerprint_mismatch_is_a_cache_miss(monkeypatch):
    """A schema change produces a new fingerprint that simply doesn't match
    any stored row -- the query returns nothing, same as never having
    classified this data source at all."""
    result = _Result(rows=[], keys=["table_name", "column_name", "classification", "confidence", "reasoning"])
    fake_session = _FakeSession(result=result)
    monkeypatch.setattr("src.db.session.async_session", lambda: fake_session)

    rows = await semantic_layer_db.get_column_classifications("ds-1", "new-fingerprint")
    assert rows == []


@pytest.mark.asyncio
async def test_get_column_classifications_fails_open_to_empty_list_on_db_error(monkeypatch):
    """This sits on the hot path of every analytics query via
    data_profiler.py -- a DB hiccup must never raise, only degrade to a
    cache miss."""
    monkeypatch.setattr("src.db.session.async_session", _raising_async_session)

    rows = await semantic_layer_db.get_column_classifications("ds-1", "fp-abc")
    assert rows == []


# ---------------------------------------------------------------------------
# upsert_column_classifications
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upsert_writes_one_row_per_column_in_a_single_transaction(monkeypatch):
    fake_session = _FakeSession()
    monkeypatch.setattr("src.db.session.async_session", lambda: fake_session)

    classifications = [
        {
            "table": "orders",
            "column": "amount",
            "column_type": "NUMERIC",
            "classification": "metric",
            "confidence": 0.9,
            "reasoning": "r1",
            "source": "llm",
        },
        {
            "table": "orders",
            "column": "status",
            "column_type": "VARCHAR",
            "classification": "dimension",
            "confidence": 0.8,
            "reasoning": "r2",
            "source": "llm",
        },
    ]
    result = await semantic_layer_db.upsert_column_classifications("ds-1", "fp-abc", classifications)

    assert result == {"success": True, "count": 2}
    # Single transaction -- one commit for the whole batch, not per-row, so a
    # partial write never leaves some columns on the new fingerprint and
    # others on the old one.
    assert fake_session.committed is True
    assert len(fake_session.executed) == 2
    written_columns = {call["params"]["cname"] for call in fake_session.executed}
    assert written_columns == {"amount", "status"}
    assert all(call["params"]["fp"] == "fp-abc" for call in fake_session.executed)
    assert all(call["params"]["ds_id"] == "ds-1" for call in fake_session.executed)


@pytest.mark.asyncio
async def test_upsert_skips_entries_without_a_column_name(monkeypatch):
    fake_session = _FakeSession()
    monkeypatch.setattr("src.db.session.async_session", lambda: fake_session)

    classifications = [
        {"table": "orders", "column": "", "classification": "metric"},  # no column name -- must be skipped
        {"table": "orders", "column": "amount", "classification": "metric", "confidence": 0.9},
    ]
    result = await semantic_layer_db.upsert_column_classifications("ds-1", "fp-abc", classifications)

    assert result["count"] == 1
    assert len(fake_session.executed) == 1
    assert fake_session.executed[0]["params"]["cname"] == "amount"


@pytest.mark.asyncio
async def test_upsert_empty_list_is_a_noop_without_opening_a_session(monkeypatch):
    def _fail_if_called():
        raise AssertionError("async_session should not be opened for an empty batch")

    monkeypatch.setattr("src.db.session.async_session", _fail_if_called)

    result = await semantic_layer_db.upsert_column_classifications("ds-1", "fp-abc", [])
    assert result == {"success": True, "count": 0}


@pytest.mark.asyncio
async def test_upsert_fails_open_on_db_error(monkeypatch):
    monkeypatch.setattr("src.db.session.async_session", _raising_async_session)

    result = await semantic_layer_db.upsert_column_classifications(
        "ds-1", "fp-abc", [{"table": "orders", "column": "amount", "classification": "metric"}]
    )
    assert result["success"] is False
    assert "error" in result


@pytest.mark.asyncio
async def test_upsert_defaults_classification_and_source_when_missing(monkeypatch):
    """classification defaults to 'dimension' (the safe default -- see
    upsert_column_classifications) and source defaults to 'llm' when a
    caller omits them."""
    fake_session = _FakeSession()
    monkeypatch.setattr("src.db.session.async_session", lambda: fake_session)

    await semantic_layer_db.upsert_column_classifications(
        "ds-1", "fp-abc", [{"table": "orders", "column": "mystery_col"}]
    )

    params = fake_session.executed[0]["params"]
    assert params["cls"] == "dimension"
    assert params["src"] == "llm"
