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


def test_namespace_is_org_prefixed_hex():
    from src.modules.pipeline.load.catalog import namespace_for

    org = uuid.UUID("11111111-2222-3333-4444-555555555555")
    assert namespace_for(org) == "org_11111111222233334444555555555555"


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
