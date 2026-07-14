"""Regression tests for EE NL2SQL file-source fast paths."""

import os

os.environ.setdefault("AISER_EDITION", "enterprise")
os.environ["DEBUG"] = "false"


def _marketing_workbook_schema():
    return {
        "tables": [
            {
                "name": "sheet_1_dim_channel",
                "logical_name": "dim_channel",
                "columns": [
                    {"name": "channel_key", "type": "BIGINT"},
                    {"name": "channel", "type": "VARCHAR"},
                ],
            },
            {
                "name": "sheet_2_dim_device",
                "logical_name": "dim_device",
                "columns": [
                    {"name": "device_key", "type": "BIGINT"},
                    {"name": "device", "type": "VARCHAR"},
                ],
            },
            {
                "name": "sheet_6_fact_marketing_campaign",
                "logical_name": "fact_marketing_campaign",
                "columns": [
                    {"name": "fact_id", "type": "BIGINT"},
                    {"name": "device_key", "type": "BIGINT"},
                    {"name": "channel_key", "type": "BIGINT"},
                    {"name": "clicks", "type": "BIGINT"},
                    {"name": "conversions", "type": "BIGINT"},
                    {"name": "impressions", "type": "BIGINT"},
                ],
            },
        ]
    }


def test_file_ratio_breakdown_sql_joins_fact_to_dimension():
    from ee.modules.ai.nodes.nl2sql_node import _build_file_ratio_breakdown_sql

    sql = _build_file_ratio_breakdown_sql(
        "How does conversion rate (conversions/clicks) vary by device type "
        "are mobile users converting at a different rate than desktop or tablet users?",
        _marketing_workbook_schema(),
    )

    assert sql is not None
    assert 'FROM "sheet_6_fact_marketing_campaign" f' in sql
    assert 'JOIN "sheet_2_dim_device" d ON f."device_key" = d."device_key"' in sql
    assert 'd."device" AS "device"' in sql
    assert 'SUM(f."conversions") AS "total_conversions"' in sql
    assert 'SUM(f."clicks") AS "total_clicks"' in sql
    assert '100.0 * SUM(f."conversions") / NULLIF(SUM(f."clicks"), 0) AS "conversion_rate_pct"' in sql
    assert 'GROUP BY d."device"' in sql
    assert 'ORDER BY "conversion_rate_pct" DESC LIMIT 100' in sql


def test_schema_formatter_labels_multi_table_file_sources():
    from ee.modules.ai.utils.schema_for_llm import format_schema_for_llm

    rendered = format_schema_for_llm(
        _marketing_workbook_schema(),
        query="conversion rate by device type",
        db_type="duckdb",
        data_source_type="file",
        max_tables=10,
        max_columns_per_table=None,
        compact=False,
    )

    assert "DuckDB file source with multiple tables" in rendered
    assert "sheet_2_dim_device" in rendered
    assert "sheet_6_fact_marketing_campaign" in rendered
