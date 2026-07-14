"""Regression tests for DuckDB file-source table-name rewriting."""

import os

os.environ.setdefault("AISER_EDITION", "enterprise")


def test_duckdb_file_logical_table_ref_rewrites_to_physical_sheet_table():
    from ee.modules.ai.utils.sql_cleaner import (
        qualify_unqualified_tables_in_sql,
        validate_sql_tables_against_schema,
    )

    schema = {
        "duckdb_tables": {
            "fact_marketing_campaign": "sheet_6_fact_marketing_campaign",
        },
        "tables": [
            {
                "name": "fact_marketing_campaign",
                "columns": [{"name": "impressions", "type": "BIGINT"}],
            }
        ],
    }

    sql = (
        'SELECT SUM("impressions") AS total_impressions '
        'FROM "fact_marketing_campaign" '
        'LIMIT 100'
    )

    rewritten = qualify_unqualified_tables_in_sql(
        sql,
        schema=schema,
        db_type="duckdb",
        data_source_type="file",
    )

    assert 'FROM "sheet_6_fact_marketing_campaign"' in rewritten
    assert 'FROM "fact_marketing_campaign"' not in rewritten
    assert validate_sql_tables_against_schema(
        rewritten,
        schema=schema,
        db_type="duckdb",
        data_source_type="file",
    ) == (True, None)


def test_duckdb_file_logical_name_from_normalized_schema_rewrites_join_refs():
    from ee.modules.ai.utils.sql_cleaner import qualify_unqualified_tables_in_sql

    schema = {
        "tables": [
            {
                "name": "sheet_6_fact_marketing_campaign",
                "logical_name": "fact_marketing_campaign",
                "columns": [{"name": "channel_key", "type": "BIGINT"}],
            },
            {
                "name": "sheet_1_dim_channel",
                "logical_name": "dim_channel",
                "columns": [{"name": "channel_key", "type": "BIGINT"}],
            },
        ],
    }

    sql = (
        "SELECT COUNT(*) "
        "FROM fact_marketing_campaign f "
        "JOIN dim_channel d ON f.channel_key = d.channel_key"
    )

    rewritten = qualify_unqualified_tables_in_sql(
        sql,
        schema=schema,
        db_type="duckdb",
        data_source_type="file",
    )

    assert 'FROM "sheet_6_fact_marketing_campaign" f' in rewritten
    assert 'JOIN "sheet_1_dim_channel" d' in rewritten
