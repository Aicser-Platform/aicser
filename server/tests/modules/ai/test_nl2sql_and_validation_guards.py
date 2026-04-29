import pytest

pytest.importorskip("fastapi")
from src.modules.ai.nodes.nl2sql_node import _repair_count_breakdown_sql_for_file_source
from src.modules.ai.nodes.validation_node import _is_intent_sql_shape_mismatch


@pytest.fixture
def file_schema_with_spaced_columns():
    return {
        "tables": [
            {
                "name": "data",
                "columns": [
                    {"name": "Quarter", "type": "VARCHAR"},
                    {"name": "Customer Status", "type": "VARCHAR"},
                    {"name": "Revenue", "type": "DOUBLE"},
                ],
            }
        ]
    }


def test_repair_count_breakdown_for_file_source_with_spaced_columns(file_schema_with_spaced_columns):
    query = "Count by Customer Status over time"
    bad_sql = 'SELECT "Quarter" FROM "data" LIMIT 1000'

    repaired = _repair_count_breakdown_sql_for_file_source(
        query=query,
        sql_query=bad_sql,
        schema_info=file_schema_with_spaced_columns,
    )

    assert "COUNT(*)" in repaired.upper()
    assert 'GROUP BY "Quarter", "Customer Status"' in repaired
    assert 'ORDER BY "Quarter" ASC' in repaired


def test_repair_count_breakdown_does_not_touch_non_grouped_intent(file_schema_with_spaced_columns):
    query = "Show quarter values"
    sql = 'SELECT "Quarter" FROM "data" LIMIT 1000'

    repaired = _repair_count_breakdown_sql_for_file_source(
        query=query,
        sql_query=sql,
        schema_info=file_schema_with_spaced_columns,
    )

    assert repaired == sql


def test_validation_shape_mismatch_detects_flat_preview_for_grouped_intent():
    query = "How many users by region over time?"
    sql = 'SELECT "Region" FROM "data" LIMIT 1000'

    assert _is_intent_sql_shape_mismatch(query, sql) is True


def test_validation_shape_mismatch_allows_grouped_aggregated_sql():
    query = "How many users by region over time?"
    sql = (
        'SELECT "Month", "Region", COUNT(*) AS user_count '
        'FROM "data" GROUP BY "Month", "Region" ORDER BY "Month" ASC'
    )

    assert _is_intent_sql_shape_mismatch(query, sql) is False
