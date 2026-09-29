"""Embedded analytics: a host app's customer sees only their rows, on every query path."""

import pytest

from src.modules.embed.locked_filters import LockedFilterError, apply, sanitize

SOURCE = {
    "type": "database",
    "schema": {"tables": [
        {"name": "orders", "columns": [{"name": "tenant_id"}, {"name": "amount"}, {"name": "region"}]},
        {"name": "regions", "columns": [{"name": "region"}, {"name": "label"}]},
    ]},
}
LOCK = [{"field": "tenant_id", "value": "acme"}]


def test_sanitize_rejects_what_is_not_a_plain_filter():
    assert sanitize([{"field": "tenant_id", "value": ["a", "b"]}]) == [{"field": "tenant_id", "values": ["a", "b"]}]
    for bad in ([{"field": "x; drop", "value": 1}], [{"field": "t", "value": {"a": 1}}], [{"field": "t", "value": []}]):
        with pytest.raises(ValueError):
            sanitize(bad)


def test_every_table_with_the_column_is_filtered():
    sql = apply('SELECT region, SUM(amount) FROM orders GROUP BY region', SOURCE, LOCK, "postgres")
    assert "tenant_id" in sql and "'acme'" in sql


def test_joined_tables_without_the_column_are_left_alone_but_the_fact_is_filtered():
    sql = apply('SELECT r.label, SUM(o.amount) FROM orders o JOIN regions r ON r.region = o.region GROUP BY r.label',
                SOURCE, LOCK, "postgres")
    assert sql.count("'acme'") == 1


def test_a_query_that_cannot_be_filtered_is_refused():
    with pytest.raises(LockedFilterError):
        apply("SELECT label FROM regions", SOURCE, LOCK, "postgres")


def test_values_are_literals_not_sql():
    sql = apply("SELECT amount FROM orders", SOURCE, [{"field": "tenant_id", "value": "x' OR '1'='1"}], "postgres")
    assert "'x'' OR ''1''=''1'" in sql


def test_file_uploads_are_filtered_as_their_data_table():
    sql = apply("SELECT * FROM data", {"type": "file", "schema": {}}, LOCK, "duckdb")
    assert "'acme'" in sql
