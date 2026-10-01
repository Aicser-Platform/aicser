"""Query routing: a pipeline-managed source is read from its served lakehouse tables."""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

T0 = datetime(2026, 9, 1, tzinfo=timezone.utc)


def _obj(table, layer, minutes_ago=0, uri=True, status="active"):
    return SimpleNamespace(
        id=uuid.uuid4(),
        source_table=table,
        layer=layer,
        status=status,
        storage_uri=f"s3://lake/{layer}/{table}/{minutes_ago}" if uri else None,
        row_count=10,
        schema_snapshot={"columns": [{"name": "id", "type": "int64"}]},
        created_at=T0 - timedelta(minutes=minutes_ago),
    )


# ── pure selection ──────────────────────────────────────────────────────────


def test_select_serving_tables_prefers_gold_then_newest_per_table():
    from src.modules.data.services.query_routing import select_serving_tables

    tables = select_serving_tables(
        [
            _obj("orders", "silver", minutes_ago=1),
            _obj("orders", "gold", minutes_ago=60),  # older, but more refined
            _obj("customers", "silver", minutes_ago=30),
            _obj("customers", "silver", minutes_ago=2),
            _obj("customers", "silver", minutes_ago=0, status="archived"),
            _obj("products", "silver", uri=False),  # nothing to scan
            _obj("items", "bronze"),  # raw data is never served
        ]
    )
    assert [(t["name"], t["layer"]) for t in tables] == [("customers", "silver"), ("orders", "gold")]
    assert tables[0]["storage_uri"].endswith("/2")


# ── resolver ────────────────────────────────────────────────────────────────


async def test_unroutable_types_and_missing_ids_pass_through():
    from src.modules.data.services.query_routing import resolve_query_source

    api = {"id": "a1", "type": "api"}
    assert await resolve_query_source(api) is api
    no_id = {"type": "database"}
    assert await resolve_query_source(no_id) is no_id


async def test_unmanaged_sources_pass_through(monkeypatch):
    from src.modules.data.services import query_routing

    async def none(_ds_id):
        return None

    monkeypatch.setattr(query_routing, "load_managed_lakehouse", none)
    for ds_type in ("database", "file"):
        ds = {"id": "ds-1", "type": ds_type}
        assert await query_routing.resolve_query_source(ds) is ds


async def test_managed_but_not_ready_raises(monkeypatch):
    from src.modules.data.services import query_routing

    pipeline = SimpleNamespace(id=uuid.uuid4(), name="P", options={})

    async def managed(_ds_id):
        return {"pipeline": pipeline, "tables": []}

    async def last_status(_pid):
        return "failed"

    monkeypatch.setattr(query_routing, "load_managed_lakehouse", managed)
    monkeypatch.setattr(query_routing, "_last_run_status", last_status)

    with pytest.raises(query_routing.LakehouseNotReady) as exc:
        await query_routing.resolve_query_source({"id": "ds-1", "type": "file"})
    assert exc.value.pipeline_id == pipeline.id
    assert exc.value.last_run_status == "failed"


async def test_managed_file_source_exposes_every_table_with_pipeline_primary(monkeypatch):
    from src.modules.data.services import query_routing

    pipeline = SimpleNamespace(id=uuid.uuid4(), name="Sales", options={"source_table": "orders"})
    tables = query_routing.select_serving_tables([_obj("customers", "silver"), _obj("orders", "silver")])

    async def managed(_ds_id):
        return {"pipeline": pipeline, "tables": tables}

    monkeypatch.setattr(query_routing, "load_managed_lakehouse", managed)

    result = await query_routing.resolve_query_source({"id": "ds-1", "type": "file", "name": "Upload"})

    assert result["type"] == "lakehouse_iceberg"
    assert result["original_type"] == "file"
    assert result["source_table"] == "orders"
    assert result["storage_uri"] == tables[1]["storage_uri"]
    assert [t["name"] for t in result["lakehouse_tables"]] == ["customers", "orders"]
    assert result["pipeline_name"] == "Sales"


# ── DuckDB loader ───────────────────────────────────────────────────────────


async def test_loader_registers_each_table_by_name_and_primary_as_data(monkeypatch, tmp_path):
    import duckdb

    from src.modules.data.services.multi_engine_query_service import DuckDBEngine
    from src.modules.pipeline.ingest import duckdb_s3

    # Local Parquet stands in for Iceberg: same view-per-table contract
    setup = duckdb.connect()
    for name, n in (("orders", 3), ("customers", 2)):
        setup.execute(f"COPY (SELECT range AS id FROM range({n})) TO '{tmp_path / name}.parquet' (FORMAT parquet)")
    monkeypatch.setattr(duckdb_s3, "configure_duckdb_s3", lambda conn: None)
    monkeypatch.setattr(duckdb_s3, "configure_duckdb_iceberg", lambda conn: True)
    monkeypatch.setattr(duckdb_s3, "iceberg_scan_sql", lambda uri: f"SELECT * FROM read_parquet('{uri}')")

    conn = duckdb.connect()
    await DuckDBEngine._load_lakehouse_iceberg(
        None,
        conn,
        {
            "storage_uri": str(tmp_path / "orders.parquet"),
            "source_table": "orders",
            "lakehouse_tables": [
                {"name": "customers", "storage_uri": str(tmp_path / "customers.parquet")},
                {"name": "orders", "storage_uri": str(tmp_path / "orders.parquet")},
            ],
        },
    )
    assert conn.execute('SELECT COUNT(*) FROM "customers"').fetchone()[0] == 2
    assert conn.execute('SELECT COUNT(*) FROM "orders"').fetchone()[0] == 3
    assert conn.execute("SELECT COUNT(*) FROM data").fetchone()[0] == 3


def test_lakehouse_schema_info_lists_every_served_table():
    from src.modules.data.services.query_routing import lakehouse_schema_info, select_serving_tables

    tables = select_serving_tables([_obj("orders", "gold"), _obj("customers", "silver")])
    info = lakehouse_schema_info({"lakehouse_tables": tables})
    assert [t["name"] for t in info["tables"]] == ["customers", "orders"]
    assert info["tables"][0]["columns"] == [{"name": "id", "type": "int64"}]
    # Legacy resolved dicts still describe the single "data" table
    legacy = lakehouse_schema_info({"schema": {"columns": [{"name": "x"}]}})
    assert legacy == {"tables": [{"name": "data", "columns": [{"name": "x"}]}]}


async def test_loader_reads_a_gold_lakehouse_record_from_connection_config(monkeypatch, tmp_path):
    import duckdb

    from src.modules.data.services.multi_engine_query_service import DuckDBEngine
    from src.modules.pipeline.ingest import duckdb_s3

    setup = duckdb.connect()
    setup.execute(f"COPY (SELECT 1 AS id) TO '{tmp_path / 'orders'}.parquet' (FORMAT parquet)")
    monkeypatch.setattr(duckdb_s3, "configure_duckdb_s3", lambda conn: None)
    monkeypatch.setattr(duckdb_s3, "configure_duckdb_iceberg", lambda conn: True)
    monkeypatch.setattr(duckdb_s3, "iceberg_scan_sql", lambda uri: f"SELECT * FROM read_parquet('{uri}')")

    uri = str(tmp_path / "orders.parquet")
    conn = duckdb.connect()
    await DuckDBEngine._load_lakehouse_iceberg(
        None, conn,
        {"type": "lakehouse_iceberg", "connection_config": {
            "storage_uri": uri, "source_table": "orders",
            "lakehouse_tables": [{"name": "orders", "storage_uri": uri}]}},
    )
    assert conn.execute('SELECT COUNT(*) FROM "orders"').fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM data").fetchone()[0] == 1


async def test_gold_lakehouse_source_resolves_to_the_newest_tables_of_its_origin(monkeypatch):
    """A Gold source whose stored config is a stale single-table snapshot still
    serves every current table of the source it derives from."""
    from src.modules.data.services import query_routing

    fresh = [_obj("customers", "silver"), _obj("orders", "gold"), _obj("order_items", "gold")]

    class Result:
        def __init__(self, value):
            self.value = value

        def scalars(self):
            outer = self

            class S:
                def first(self):
                    return outer.value

                def all(self):
                    return outer.value

            return S()

    class Session:
        calls = 0

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def execute(self, _stmt):
            Session.calls += 1
            return Result("origin-ds" if Session.calls == 1 else fresh)

    monkeypatch.setattr("src.db.session.async_session", lambda: Session())

    stale = {
        "id": "gold-1",
        "type": "lakehouse_iceberg",
        "connection_config": {
            "storage_uri": "s3://lake/shared/", "source_table": "order_items",
            "lake_object_id": str(uuid.uuid4()),
        },
    }
    result = await query_routing.resolve_query_source(stale)

    assert [t["name"] for t in result["lakehouse_tables"]] == ["customers", "order_items", "orders"]
    assert result["source_table"] == "order_items"
    assert result["storage_uri"] != "s3://lake/shared/"
    assert result["origin_data_source_id"] == "origin-ds"


def test_lakehouse_schema_info_hides_pipeline_audit_columns():
    """`_ingested_at` is often the only real TIMESTAMP in a table; exposed, the
    AI picked it as the time axis over the business date (a forecast over one
    month of load time instead of years of orders)."""
    from src.modules.data.services.query_routing import lakehouse_schema_info

    cols = [
        {"name": "order_id", "type": "string"},
        {"name": "order_date", "type": "string"},
        *({"name": c, "type": "string"} for c in (
            "_op", "_ingested_at", "_source_offset", "_source_event_at",
            "_source_table", "_load_id", "load_id",
        )),
    ]
    info = lakehouse_schema_info(
        {"lakehouse_tables": [{"name": "orders", "storage_uri": "s3://l/o/", "schema": {"columns": cols}}]}
    )
    assert [c["name"] for c in info["tables"][0]["columns"]] == ["order_id", "order_date"]
