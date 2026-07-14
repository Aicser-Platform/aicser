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
