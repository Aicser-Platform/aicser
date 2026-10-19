"""Warehouse exports keep the source's column types (a decimal must not land as text)."""

import datetime as dt
import decimal
import os

import pyarrow as pa

os.environ.setdefault("AISER_EDITION", "enterprise")


def test_arrow_types_map_to_sql_types():
    from sqlalchemy import types as T

    from src.modules.pipeline.load.external_loader import sql_column_types

    schema = pa.schema([
        ("amount", pa.decimal128(10, 2)), ("at", pa.timestamp("us", tz="UTC")), ("local", pa.timestamp("us")),
        ("day", pa.date32()), ("ok", pa.bool_()), ("n", pa.int64()), ("small", pa.int16()), ("x", pa.float64()),
        ("name", pa.string()), ("blob", pa.binary()),
    ])
    got = sql_column_types(schema)
    assert isinstance(got["amount"], T.Numeric) and (got["amount"].precision, got["amount"].scale) == (10, 2)
    assert got["at"].timezone is True and got["local"].timezone is False
    assert isinstance(got["day"], T.Date) and isinstance(got["ok"], T.Boolean)
    assert isinstance(got["n"], T.BigInteger) and isinstance(got["small"], T.Integer)
    assert isinstance(got["name"], T.Text) and isinstance(got["blob"], T.LargeBinary)


def test_decimals_stay_numeric_in_a_real_table(tmp_path):
    from sqlalchemy import create_engine, inspect, types as T

    from src.modules.pipeline.load.external_loader import sql_column_types

    table = pa.table({
        "amount": pa.array([decimal.Decimal("10.50"), decimal.Decimal("7.25")], pa.decimal128(10, 2)),
        "day": pa.array([dt.date(2026, 1, 1), dt.date(2026, 1, 2)], pa.date32()),
    })
    engine = create_engine(f"sqlite:///{tmp_path / 'dest.db'}")
    table.to_pandas().to_sql("orders", engine, index=False, dtype=sql_column_types(table.schema))
    cols = {c["name"]: c["type"] for c in inspect(engine).get_columns("orders")}
    assert isinstance(cols["amount"], T.NUMERIC) and isinstance(cols["day"], T.DATE)
    engine.dispose()


def test_streams_land_under_their_table_name():
    from src.modules.pipeline.transform.stage import destination_table_name

    assert destination_table_name("public.orders") == "orders"
    assert destination_table_name("dbo.Orders") == "Orders"
    assert destination_table_name("Sheet1") == "Sheet1"  # existing exports keep their table
    assert destination_table_name("sales.orders") == "sales_orders"
    assert destination_table_name('"Sales"."Order Lines"') == "Sales_Order_Lines"
    assert destination_table_name("orders") == "orders"
    assert destination_table_name("shop.public.orders") == "orders"
