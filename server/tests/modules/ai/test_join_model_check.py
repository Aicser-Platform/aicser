import re

from ee.modules.ai.utils.join_model_check import check_joins_against_model

JOINS = [{"from_table": "fact_sales", "from_column": "device_key",
          "to_table": "dim_device", "to_column": "device_key", "join_type": "LEFT"}]


def test_matching_join_passes():
    sql = ("SELECT d.device_name, SUM(f.amount) FROM fact_sales f "
           "LEFT JOIN dim_device d ON fact_sales.device_key = dim_device.device_key GROUP BY 1")
    assert check_joins_against_model(sql, JOINS) == []


def test_matching_join_reversed_order_passes():
    sql = "SELECT 1 FROM fact_sales JOIN dim_device ON dim_device.device_key = fact_sales.device_key"
    assert check_joins_against_model(sql, JOINS) == []


def test_unmodeled_join_flagged():
    sql = "SELECT 1 FROM fact_sales JOIN dim_device ON fact_sales.store_key = dim_device.device_key"
    findings = check_joins_against_model(sql, JOINS)
    assert len(findings) == 1
    assert "unmodeled_join" in findings[0]


def test_no_model_no_findings():
    sql = "SELECT 1 FROM a JOIN b ON a.x = b.y"
    assert check_joins_against_model(sql, []) == []


def test_sql_without_joins_no_findings():
    assert check_joins_against_model("SELECT * FROM data LIMIT 5", JOINS) == []


def test_multiline_sql_join_detected_by_guard_pattern():
    # Regression: validate_sql_node's outer gate used to be a strict
    # " JOIN " substring test, which missed the newline-formatted SQL that
    # LLMs commonly produce and silently skipped the whole join-model check.
    sql_query = "SELECT d.device_name\nFROM fact_sales f\nJOIN dim_device d ON f.device_key = d.device_key"
    assert re.search(r'\bJOIN\b', sql_query, re.IGNORECASE) is not None
