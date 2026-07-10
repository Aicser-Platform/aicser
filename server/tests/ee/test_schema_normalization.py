"""Regression tests for EE AI schema normalization."""


def test_multi_sheet_excel_schema_uses_duckdb_physical_table_names():
    from ee.modules.ai.utils.schema_normalization import normalize_file_schema_for_nl2sql

    schema = {
        "duckdb_tables": {
            "dim_campaign": "sheet_0_dim_campaign",
            "fact_marketing_campaign": "sheet_6_fact_marketing_campaign",
        },
        "tables": [
            {
                "name": "dim_campaign",
                "columns": [{"name": "campaign_key", "type": "string"}],
                "row_count": 2,
            },
            {
                "name": "fact_marketing_campaign",
                "columns": [
                    {"name": "channel", "type": "string"},
                    {"name": "impressions", "type": "number"},
                    {"name": "start_date", "type": "date"},
                ],
                "row_count": 100,
            },
        ],
    }

    normalized = normalize_file_schema_for_nl2sql(schema)

    tables = normalized["tables"]
    assert [table["name"] for table in tables] == [
        "sheet_0_dim_campaign",
        "sheet_6_fact_marketing_campaign",
    ]
    assert tables[0]["logical_name"] == "dim_campaign"
    assert tables[1]["logical_name"] == "fact_marketing_campaign"
    assert [column["name"] for column in tables[1]["columns"]] == [
        "channel",
        "impressions",
        "start_date",
    ]
    assert tables[1]["columns"][1]["type"] == "DOUBLE"


def test_single_table_file_schema_still_uses_data_table():
    from ee.modules.ai.utils.schema_normalization import normalize_file_schema_for_nl2sql

    schema = {
        "tables": [
            {
                "name": "uploaded_csv",
                "columns": [{"name": "amount", "type": "number"}],
                "row_count": 10,
            }
        ]
    }

    normalized = normalize_file_schema_for_nl2sql(schema)

    assert normalized["tables"] == [
        {
            "name": "data",
            "columns": [{"name": "amount", "type": "DOUBLE"}],
            "row_count": 10,
        }
    ]
