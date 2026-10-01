"""Auto routing by table size and load; DataFusion SQL rewrite; the read-only Iceberg catalog."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.warehouse import engine as E

WH = SimpleNamespace(id="w1", max_concurrent=2, size="small")


def _t(size, fmt="iceberg", ident="org_x_gold.t"):
    return {"name": "t", "format": fmt, "byte_size": size, "identifier": ident}


def test_auto_routes_by_scan_size(monkeypatch):
    monkeypatch.setenv("WAREHOUSE_COMPUTE_URL", "http://pool")
    monkeypatch.setenv("WAREHOUSE_COMPUTE_TOKEN", "x")
    monkeypatch.setenv("TRINO_URL", "http://trino:8080")
    assert E.choose_engine(WH, [_t(10_000_000)]) == "embedded"
    assert E.choose_engine(WH, [_t(E.AUTO_POOL_BYTES)]) == "pool"
    assert E.choose_engine(WH, [_t(E.AUTO_TRINO_BYTES)]) == "trino"
    # Trino reads Iceberg with single-level namespaces only; otherwise the pool takes it.
    assert E.choose_engine(WH, [_t(E.AUTO_TRINO_BYTES, fmt="parquet")]) == "pool"


def test_auto_without_pool_or_trino_stays_embedded(monkeypatch):
    for v in ("WAREHOUSE_COMPUTE_URL", "WAREHOUSE_COMPUTE_TOKEN", "TRINO_URL"):
        monkeypatch.delenv(v, raising=False)
    assert E.choose_engine(WH, [_t(E.AUTO_TRINO_BYTES * 10)]) == "embedded"


def test_busy_embedded_queue_spills_to_the_pool(monkeypatch):
    monkeypatch.setenv("WAREHOUSE_COMPUTE_URL", "http://pool")
    monkeypatch.setenv("WAREHOUSE_COMPUTE_TOKEN", "x")
    wh = SimpleNamespace(id="busy", max_concurrent=1, size="small")

    async def hold():
        q = E._queue(wh)
        await q.acquire()
        try:
            return E.choose_engine(wh, [_t(1000)])
        finally:
            q.release()

    assert asyncio.run(hold()) == "pool"


def test_group_by_all_becomes_positions():
    import sqlglot

    tree = sqlglot.parse_one("SELECT a, b, sum(x) FROM t GROUP BY ALL", read="duckdb")
    E._expand_group_by_all(tree)
    assert "GROUP BY 1, 2" in tree.sql(dialect="postgres")


@pytest.mark.asyncio
async def test_catalog_is_read_only_and_answers_in_the_spec_envelope():
    from ee.modules.warehouse import iceberg_rest as R

    with patch.object(R, "_caller", new=AsyncMock(return_value=SimpleNamespace(organization_id="o", user_id="u"))), \
         patch.object(R, "_iceberg_tables", new=AsyncMock(return_value={("org_o_gold", "orders"): {"location": "x"}})):
        r = await R.read_only("namespaces/org_o_gold/tables/orders", request=None)
        assert r.status_code == 405 and b'"type":"NotSupportedException"' in r.body
        missing = await R.load_table("org_o_gold", "nope", request=SimpleNamespace(method="GET"))
        assert missing.status_code == 404 and b'"error"' in missing.body
        listed = await R.list_tables("org_o_gold", request=None)
        assert listed == {"identifiers": [{"namespace": ["org_o_gold"], "name": "orders"}]}
