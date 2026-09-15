"""Ingest -> Transform -> Load, end to end, entirely on local resources."""

import os

os.environ.setdefault("AISER_EDITION", "enterprise")

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

YAML = """
version: 1
source: {asset: bronze.orders}
transform:
  - filter:    {where: "status <> 'test'"}
  - cast:      {amount: "decimal(18,2)"}
  - validate:  {not_null: [id], on_fail: quarantine}
  - aggregate: {by: [region], sum: [amount]}
output:
  layer: gold
  table: sales_by_region
  write_mode: merge
  primary_key: [region]
"""


@pytest.fixture
def bronze_parquet(tmp_path):
    path = tmp_path / "bronze.parquet"
    pq.write_table(
        pa.table(
            {
                "id": pa.array([1, 2, 3, None], type=pa.int64()),
                "status": pa.array(["ok", "test", "ok", "ok"], type=pa.string()),
                "region": pa.array(["eu", "eu", "us", "us"], type=pa.string()),
                "amount": pa.array(["10.5", "99.0", "20.0", "5.0"], type=pa.string()),
            }
        ),
        path,
    )
    return path


@pytest.fixture
def local_catalog(tmp_path):
    from pyiceberg.catalog.sql import SqlCatalog

    warehouse = tmp_path / "warehouse"
    warehouse.mkdir()
    return SqlCatalog(
        "t",
        uri=f"sqlite:///{tmp_path / 'c.db'}",
        warehouse=f"file://{warehouse}",
    )


def test_transform_then_load_produces_the_expected_gold_table(
    bronze_parquet, local_catalog
):
    from src.modules.pipeline.load.iceberg_loader import load_to_iceberg
    from src.modules.pipeline.transform.compiler import (compile_transform,
                                                         parse_yaml)
    from src.modules.pipeline.transform.executor import (execute_quarantine,
                                                         execute_transform)

    compiled = compile_transform(
        parse_yaml(YAML),
        source_sql=f"SELECT * FROM read_parquet('{bronze_parquet}')",
    )
    conn = duckdb.connect()
    table = execute_transform(compiled, connection=conn)

    rows = {r["region"]: float(r["amount"]) for r in table.to_pylist()}
    assert rows == {"eu": 10.5, "us": 20.0}

    quarantined = execute_quarantine(compiled, connection=conn)
    assert quarantined is not None and quarantined.num_rows == 1
    assert quarantined.column("_quarantine_reason").to_pylist() == ["not_null:id"]

    local_catalog.create_namespace("org_e2e")
    result = load_to_iceberg(
        local_catalog,
        namespace="org_e2e",
        table_name="sales_by_region",
        table=table,
        write_mode="merge",
        primary_key=["region"],
    )
    assert result["created"] is True
    assert (
        local_catalog.load_table("org_e2e.sales_by_region").scan().to_arrow().num_rows
        == 2
    )


def test_rerunning_the_whole_pipeline_is_idempotent(bronze_parquet, local_catalog):
    """The property that makes retries safe: run twice, identical Gold table."""
    from src.modules.pipeline.load.iceberg_loader import load_to_iceberg
    from src.modules.pipeline.transform.compiler import (compile_transform,
                                                         parse_yaml)
    from src.modules.pipeline.transform.executor import execute_transform

    compiled = compile_transform(
        parse_yaml(YAML),
        source_sql=f"SELECT * FROM read_parquet('{bronze_parquet}')",
    )
    table = execute_transform(compiled, connection=duckdb.connect())

    local_catalog.create_namespace("org_idem")
    for _ in range(2):
        load_to_iceberg(
            local_catalog,
            namespace="org_idem",
            table_name="g",
            table=table,
            write_mode="merge",
            primary_key=["region"],
        )

    out = local_catalog.load_table("org_idem.g").scan().to_arrow()
    assert out.num_rows == 2, "a second identical run must not duplicate rows"


async def test_load_stage_records_the_pipeline_source_table(bronze_parquet, local_catalog, monkeypatch):
    """A preview/catalog lookup for a specific table needs the Silver/Gold
    row LoadStage writes to be tagged with the same source_table IngestStage
    recorded for the Bronze row it read -- otherwise selecting a table in the
    builder can find Bronze correctly but still show stale Silver data from a
    different table (the exact production bug this closes)."""
    from unittest.mock import AsyncMock, MagicMock

    from src.modules.pipeline.load.catalog import namespace_for
    from src.modules.pipeline.runner import RunContext
    from src.modules.pipeline.transform.compiler import compile_transform, parse_yaml
    from src.modules.pipeline.transform.executor import execute_transform

    compiled = compile_transform(
        parse_yaml(YAML), source_sql=f"SELECT * FROM read_parquet('{bronze_parquet}')"
    )
    table = execute_transform(compiled, connection=duckdb.connect())

    added = []
    session = AsyncMock()
    session.add = MagicMock(side_effect=added.append)

    import uuid

    org_id = uuid.uuid4()
    local_catalog.create_namespace(namespace_for(org_id))
    monkeypatch.setattr("src.modules.pipeline.load.catalog.get_catalog", lambda: local_catalog)
    # LoadStage always builds a real s3:// location for catalog.create_table,
    # which the other e2e tests in this file avoid by calling load_to_iceberg
    # directly (no location kwarg -> falls back to the local warehouse). This
    # test is only about source_table propagation through LoadStage, which
    # Iceberg write mechanics the other two tests already cover -- so stub the
    # write itself rather than requiring a real S3 bucket in the test run.
    monkeypatch.setattr(
        "src.modules.pipeline.load.iceberg_loader.load_to_iceberg",
        lambda *a, **kw: {
            "created": True,
            "identifier": f"{namespace_for(org_id)}.sales_by_region",
            "location": "s3://test-bucket/fake",
            "rows_written": table.num_rows,
        },
    )

    ctx = RunContext(
        session=session,
        run=type("R", (), {"id": uuid.uuid4()})(),
        pipeline=type(
            "P",
            (),
            {
                "source_asset_id": "db_mysql_1",
                "source_asset_type": "data_source",
                "options": {"source_table": "orders"},
            },
        )(),
        org_id=org_id,
        arrow_table=table,
        compiled=compiled,
    )

    from src.modules.pipeline.load.stage import LoadStage

    await LoadStage().execute(ctx)

    assert len(added) == 1
    assert added[0].data_source_id == "db_mysql_1"
    assert added[0].source_table == "orders"


def test_lineage_is_captured_from_the_compiled_sql(bronze_parquet):
    from src.modules.pipeline.transform.compiler import (compile_transform,
                                                         parse_yaml)
    from src.modules.pipeline.transform.lineage import extract_column_lineage

    compiled = compile_transform(
        parse_yaml(YAML),
        source_sql=f"SELECT * FROM read_parquet('{bronze_parquet}')",
    )
    mapping = extract_column_lineage(compiled.sql)

    assert "amount" in mapping
    assert "region" in mapping
