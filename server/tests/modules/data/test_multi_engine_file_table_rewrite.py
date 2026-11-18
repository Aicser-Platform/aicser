"""Regression tests for file-upload DuckDB table reference rewriting."""

from src.modules.data.services.multi_engine_query_service import rewrite_file_duckdb_table_refs


def test_rewrites_schema_qualified_logical_sheet_table_to_physical_table():
    data_source = {
        "type": "file",
        "format": "xlsx",
        "schema": {
            "duckdb_tables": {
                "fact_marketing_campaign": "sheet_6_fact_marketing_campaign",
            },
            "tables": [
                {
                    "name": "fact_marketing_campaign",
                    "columns": [{"name": "fact_id", "type": "BIGINT"}],
                }
            ],
        },
    }
    sql = (
        'SELECT "fact_marketing_campaign"."fact_id" AS x, '
        'SUM("fact_marketing_campaign"."conversions") AS y_0 '
        'FROM "data"."fact_marketing_campaign" AS "fact_marketing_campaign" '
        'GROUP BY "fact_marketing_campaign"."fact_id" '
        'ORDER BY x DESC LIMIT 5000'
    )

    rewritten, error, refs = rewrite_file_duckdb_table_refs(sql, data_source)

    assert error is None
    assert refs == ['"data"."fact_marketing_campaign"']
    assert 'FROM "sheet_6_fact_marketing_campaign" AS "fact_marketing_campaign"' in rewritten
    assert 'FROM "data"."fact_marketing_campaign"' not in rewritten


def test_strips_data_prefix_from_schema_qualified_physical_sheet_table():
    data_source = {
        "type": "file",
        "format": "xlsx",
        "schema": {
            "duckdb_tables": {
                "fact_marketing_campaign": "sheet_6_fact_marketing_campaign",
            },
            "tables": [
                {
                    "name": "sheet_6_fact_marketing_campaign",
                    "logical_name": "fact_marketing_campaign",
                    "columns": [{"name": "fact_id", "type": "BIGINT"}],
                }
            ],
        },
    }
    sql = 'SELECT COUNT(*) FROM "data"."sheet_6_fact_marketing_campaign" AS f'

    rewritten, error, refs = rewrite_file_duckdb_table_refs(sql, data_source)

    assert error is None
    assert refs == ['"data"."sheet_6_fact_marketing_campaign"']
    assert rewritten == 'SELECT COUNT(*) FROM "sheet_6_fact_marketing_campaign" AS f'


def test_logical_names_inside_an_injected_subquery_are_rewritten():
    """RLS injection runs before file-source table rewriting."""
    data_source = {
        "type": "file",
        "format": "xlsx",
        "schema": {"duckdb_tables": {"fact_orders": "sheet_1_fact_orders"}},
    }
    injected = (
        "SELECT amount FROM "
        "(SELECT * FROM fact_orders WHERE customer_id = 'C001') AS fact_orders"
    )

    rewritten, error, _refs = rewrite_file_duckdb_table_refs(injected, data_source)

    assert error is None
    assert "sheet_1_fact_orders" in rewritten
    assert "AS fact_orders" in rewritten


def _lakehouse(*names):
    return {
        "type": "lakehouse_iceberg",
        "source_table": names[0],
        "lakehouse_tables": [{"name": n, "storage_uri": f"s3://lake/{n}/"} for n in names],
    }


def test_lakehouse_refs_keep_their_real_table_names():
    from src.modules.data.services.multi_engine_query_service import rewrite_lakehouse_table_refs

    sql = "SELECT * FROM order_items oi JOIN products p ON oi.product_id = p.product_id"
    assert rewrite_lakehouse_table_refs(sql, _lakehouse("customers", "order_items", "products")) == sql


def test_lakehouse_refs_drop_schema_qualifiers_of_served_tables():
    from src.modules.data.services.multi_engine_query_service import rewrite_lakehouse_table_refs

    sql = 'SELECT * FROM main.Orders o JOIN "shop"."customers" c ON o.cid = c.id'
    assert rewrite_lakehouse_table_refs(sql, _lakehouse("customers", "Orders")) == (
        'SELECT * FROM "Orders" o JOIN "customers" c ON o.cid = c.id'
    )


def test_lakehouse_unknown_table_is_not_redirected_to_data():
    """File uploads send unknown refs to "data"; for a lakehouse that silently
    answered with the primary table's rows (order_items read as customers)."""
    from src.modules.data.services.multi_engine_query_service import rewrite_lakehouse_table_refs

    sql = "SELECT * FROM shop.invoices"
    assert rewrite_lakehouse_table_refs(sql, _lakehouse("customers")) == sql


def test_lakehouse_is_multi_table_not_a_file_upload():
    from src.modules.ai.data_source_capabilities import (
        is_file_upload_duckdb, is_single_table_source, needs_schema_qualification,
        uses_duckdb_for_execution)

    assert uses_duckdb_for_execution("lakehouse_iceberg")
    assert not is_file_upload_duckdb("lakehouse_iceberg")
    assert not is_single_table_source("lakehouse_iceberg", "duckdb")
    assert not needs_schema_qualification("duckdb", "lakehouse_iceberg")


def _workbook():
    return {
        "type": "file",
        "schema": {
            "duckdb_tables": {"customers": "sheet_0_customers", "orders": "sheet_2_orders"},
            "tables": [{"name": "customers"}, {"name": "orders"}],
        },
    }


def test_column_security_alias_keeps_its_qualifiers():
    """CLS output aliases the table to its own name; renaming the qualifiers
    with the table left them pointing at nothing (DuckDB Binder Error)."""
    sql = (
        'SELECT "customers"."customer_id" AS "customer_id", \'***MASKED***\' AS "email" '
        'FROM "customers" AS "customers" LIMIT 100'
    )
    rewritten, error, _ = rewrite_file_duckdb_table_refs(sql, _workbook())
    assert error is None
    assert rewritten == (
        'SELECT "customers"."customer_id" AS "customer_id", \'***MASKED***\' AS "email" '
        'FROM "sheet_0_customers" AS "customers" LIMIT 100'
    )


def test_row_security_subquery_alias_keeps_its_qualifiers():
    sql = (
        "SELECT customers.city FROM (SELECT * FROM customers WHERE country = 'US') AS customers "
        "JOIN orders ON orders.customer_id = customers.customer_id"
    )
    rewritten, error, _ = rewrite_file_duckdb_table_refs(sql, _workbook())
    assert error is None
    assert rewritten == (
        "SELECT customers.city FROM (SELECT * FROM \"sheet_0_customers\" WHERE country = 'US') AS customers "
        'JOIN "sheet_2_orders" ON "sheet_2_orders".customer_id = customers.customer_id'
    )


def test_unaliased_qualifiers_still_follow_the_table():
    sql = "SELECT SUM(orders.amount) FROM orders WHERE orders.status = 'paid'"
    rewritten, _, _ = rewrite_file_duckdb_table_refs(sql, _workbook())
    assert rewritten == (
        'SELECT SUM("sheet_2_orders".amount) FROM "sheet_2_orders" WHERE "sheet_2_orders".status = \'paid\''
    )
