import os
import uuid

os.environ.setdefault("AISER_EDITION", "enterprise")

import pyarrow as pa
import pytest


def test_sync_catalog_uri_converts_asyncpg_to_psycopg2():
    """PyIceberg's SqlCatalog uses sync SQLAlchemy; the app URL is asyncpg."""
    from src.modules.pipeline.load.catalog import sync_catalog_uri

    assert (
        sync_catalog_uri("postgresql+asyncpg://u:p@h:5432/db")
        == "postgresql+psycopg2://u:p@h:5432/db"
    )
    assert sync_catalog_uri("postgresql://u:p@h/db") == "postgresql+psycopg2://u:p@h/db"


def test_namespace_is_org_prefixed_hex_per_layer():
    from src.modules.pipeline.load.catalog import namespace_for

    org = uuid.UUID("11111111-2222-3333-4444-555555555555")
    assert namespace_for(org, "gold") == "org_11111111222233334444555555555555_gold"
    assert namespace_for(str(org), "silver") == "org_11111111222233334444555555555555_silver"


@pytest.fixture
def local_catalog(tmp_path):
    """A real SqlCatalog on SQLite with a local-filesystem warehouse."""
    from pyiceberg.catalog.sql import SqlCatalog

    warehouse = tmp_path / "warehouse"
    warehouse.mkdir()
    return SqlCatalog(
        "test",
        **{
            "uri": f"sqlite:///{tmp_path / 'catalog.db'}",
            "warehouse": f"file://{warehouse}",
        },
    )


def _table(ids, amounts):
    return pa.table(
        {
            "id": pa.array(ids, type=pa.int64()),
            "amount": pa.array(amounts, type=pa.float64()),
        }
    )


def test_append_creates_the_table_on_first_run(local_catalog):
    from src.modules.pipeline.load.iceberg_loader import load_to_iceberg

    local_catalog.create_namespace("org_x")
    res = load_to_iceberg(
        local_catalog,
        namespace="org_x",
        table_name="orders",
        table=_table([1, 2], [10.0, 20.0]),
        write_mode="append",
        primary_key=[],
    )

    assert res["rows_written"] == 2
    assert res["created"] is True
    assert local_catalog.load_table("org_x.orders").scan().to_arrow().num_rows == 2


def test_reports_the_data_file_bytes_of_the_current_snapshot(local_catalog):
    """byte_size feeds the Warehouse's scan-size guard: it must cover every data
    file a full scan reads, not just the files this load added."""
    import os

    from src.modules.pipeline.load.iceberg_loader import load_to_iceberg

    local_catalog.create_namespace("org_x")
    kwargs = dict(namespace="org_x", table_name="orders", write_mode="append", primary_key=[])
    first = load_to_iceberg(local_catalog, table=_table([1, 2], [10.0, 20.0]), **kwargs)
    second = load_to_iceberg(local_catalog, table=_table([3], [30.0]), **kwargs)

    files = local_catalog.load_table("org_x.orders").inspect.files().column("file_path").to_pylist()
    on_disk = sum(os.path.getsize(f.removeprefix("file://")) for f in files)
    assert first["byte_size"] > 0
    assert second["byte_size"] == on_disk > first["byte_size"]


def test_upsert_is_idempotent(local_catalog):
    """Running the same merge twice must leave the table identical."""
    from src.modules.pipeline.load.iceberg_loader import load_to_iceberg

    local_catalog.create_namespace("org_x")
    data = _table([1, 2, 3], [10.0, 20.0, 30.0])

    load_to_iceberg(
        local_catalog,
        namespace="org_x",
        table_name="o",
        table=data,
        write_mode="merge",
        primary_key=["id"],
    )
    first = local_catalog.load_table("org_x.o").scan().to_arrow().sort_by("id")

    load_to_iceberg(
        local_catalog,
        namespace="org_x",
        table_name="o",
        table=data,
        write_mode="merge",
        primary_key=["id"],
    )
    second = local_catalog.load_table("org_x.o").scan().to_arrow().sort_by("id")

    assert first.num_rows == 3
    assert second.num_rows == 3
    assert first.equals(second)


def test_upsert_updates_changed_rows_and_inserts_new_ones(local_catalog):
    from src.modules.pipeline.load.iceberg_loader import load_to_iceberg

    local_catalog.create_namespace("org_x")
    load_to_iceberg(
        local_catalog,
        namespace="org_x",
        table_name="o",
        table=_table([1, 2], [10.0, 20.0]),
        write_mode="merge",
        primary_key=["id"],
    )
    load_to_iceberg(
        local_catalog,
        namespace="org_x",
        table_name="o",
        table=_table([2, 3], [99.0, 30.0]),
        write_mode="merge",
        primary_key=["id"],
    )

    out = local_catalog.load_table("org_x.o").scan().to_arrow().sort_by("id")
    assert out.column("id").to_pylist() == [1, 2, 3]
    assert out.column("amount").to_pylist() == [10.0, 99.0, 30.0]


def test_added_column_evolves_the_schema(local_catalog):
    from src.modules.pipeline.load.iceberg_loader import load_to_iceberg

    local_catalog.create_namespace("org_x")
    load_to_iceberg(
        local_catalog,
        namespace="org_x",
        table_name="o",
        table=_table([1], [10.0]),
        write_mode="append",
        primary_key=[],
    )

    widened = pa.table(
        {
            "id": pa.array([2], type=pa.int64()),
            "amount": pa.array([20.0], type=pa.float64()),
            "region": pa.array(["eu"], type=pa.string()),
        }
    )
    load_to_iceberg(
        local_catalog,
        namespace="org_x",
        table_name="o",
        table=widened,
        write_mode="append",
        primary_key=[],
    )

    out = local_catalog.load_table("org_x.o").scan().to_arrow()
    assert "region" in out.schema.names


def test_incompatible_type_change_fails_loudly(local_catalog):
    """A narrowing change must abort the run naming the column, never coerce silently."""
    from src.modules.pipeline.load.iceberg_loader import (SchemaConflict,
                                                          load_to_iceberg)

    local_catalog.create_namespace("org_x")
    load_to_iceberg(
        local_catalog,
        namespace="org_x",
        table_name="o",
        table=_table([1], [10.0]),
        write_mode="append",
        primary_key=[],
    )

    conflicting = pa.table(
        {
            "id": pa.array([2], type=pa.int64()),
            "amount": pa.array(["not a number"], type=pa.string()),
        }
    )
    with pytest.raises(SchemaConflict) as exc:
        load_to_iceberg(
            local_catalog,
            namespace="org_x",
            table_name="o",
            table=conflicting,
            write_mode="append",
            primary_key=[],
        )

    assert "amount" in str(exc.value)
    assert exc.value.error_code == "schema_conflict"


def test_compatible_utc_timestamp_variance_is_accepted(local_catalog):
    """UTC and Etc/UTC are synonymous and must not trigger schema conflict."""
    from src.modules.pipeline.load.iceberg_loader import load_to_iceberg

    local_catalog.create_namespace("org_x")
    initial = pa.table(
        {
            "id": pa.array([1], type=pa.int64()),
            "_ingested_at": pa.array([1700000000000000], type=pa.timestamp("us", tz="UTC")),
        }
    )
    load_to_iceberg(
        local_catalog,
        namespace="org_x",
        table_name="ts_test",
        table=initial,
        write_mode="append",
        primary_key=[],
    )

    incoming_etc_utc = pa.table(
        {
            "id": pa.array([2], type=pa.int64()),
            "_ingested_at": pa.array([1700000001000000], type=pa.timestamp("us", tz="Etc/UTC")),
        }
    )
    # Must succeed without SchemaConflict
    result = load_to_iceberg(
        local_catalog,
        namespace="org_x",
        table_name="ts_test",
        table=incoming_etc_utc,
        write_mode="append",
        primary_key=[],
    )
    assert result["rows_written"] == 1


def test_appending_small_precision_decimal_rows_does_not_raise(local_catalog):
    """PyArrow's Parquet writer always encodes decimal columns as
    FIXED_LEN_BYTE_ARRAY (apache/iceberg-python#936), but pyiceberg 0.9.x's
    stats collector still expects INT32 for precision<=9 / INT64 for <=18 and
    raises `Unexpected physical type FIXED_LEN_BYTE_ARRAY ... expected INT32`
    before it ever writes the file -- reproduced live against the real MySQL
    crm database: a `customers` table with a `revenue decimal(9,2)` column
    failed every append with this exact error, so no row of real customer
    data ever reached Silver. Reproduces with real (non-null) values on a
    *second* write into an already-existing table, which is what forces the
    append path rather than create_table."""
    import decimal

    from src.modules.pipeline.load.iceberg_loader import load_to_iceberg

    local_catalog.create_namespace("org_decimal")

    def rows(values):
        return pa.table(
            {
                "id": pa.array(range(len(values)), type=pa.int64()),
                "revenue": pa.array(
                    [decimal.Decimal(v) if v is not None else None for v in values],
                    type=pa.decimal128(9, 2),
                ),
            }
        )

    load_to_iceberg(
        local_catalog,
        namespace="org_decimal",
        table_name="customers_silver",
        table=rows(["100.00"]),
        write_mode="append",
        primary_key=[],
    )

    result = load_to_iceberg(
        local_catalog,
        namespace="org_decimal",
        table_name="customers_silver",
        table=rows([f"{n}.56" for n in range(1, 80)]),
        write_mode="append",
        primary_key=[],
    )

    assert result["rows_written"] == 79
    out = local_catalog.load_table("org_decimal.customers_silver").scan().to_arrow()
    assert out.num_rows == 80


def test_rebuild_replaces_a_changed_column_type_and_the_rows(local_catalog):
    """A Silver table that stored price as text (the old "Replace NULLs → Unknown") can be
    rebuilt as decimal when the user asks; without asking it still fails loudly."""
    from decimal import Decimal

    from src.modules.pipeline.load.iceberg_loader import SchemaConflict, load_to_iceberg

    local_catalog.create_namespace("org_x")
    kwargs = dict(namespace="org_x", table_name="products", primary_key=["id"])
    old = pa.table({"id": pa.array([1, 2], pa.int64()), "price": pa.array(["362.68", "Unknown"])})
    load_to_iceberg(local_catalog, table=old, write_mode="merge", **kwargs)

    new = pa.table({"id": pa.array([1, 2], pa.int64()), "price": pa.array([Decimal("362.68"), None], pa.decimal128(18, 2))})
    with pytest.raises(SchemaConflict):
        load_to_iceberg(local_catalog, table=new, write_mode="merge", **kwargs)

    res = load_to_iceberg(local_catalog, table=new, write_mode="merge", replace_schema=True, **kwargs)

    out = local_catalog.load_table("org_x.products").scan().to_arrow()
    assert res["rows_written"] == 2
    assert pa.types.is_decimal(out.schema.field("price").type)
    assert sorted(out.column("price").to_pylist(), key=str) == sorted([Decimal("362.68"), None], key=str)
