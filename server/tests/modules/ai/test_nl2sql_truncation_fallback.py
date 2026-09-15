"""Truncation fallback SQL must produce a series for 'per month over time' asks."""

from ee.modules.ai.nodes.nl2sql_node import (
    _build_file_truncation_fallback_sql,
    _sql_is_unhelpful_history_base,
)


def test_truncation_fallback_counts_by_month_not_total_records():
    sql = _build_file_truncation_fallback_sql(
        "how many customers per month over time",
        {
            "tables": [
                {
                    "name": "accounts",
                    "columns": [
                        {"name": "customer_id", "type": "INTEGER"},
                        {"name": "created_at", "type": "TIMESTAMP"},
                    ],
                }
            ]
        },
    )
    assert sql
    assert "GROUP BY" in sql
    assert "period" in sql.lower()
    assert "total_records" not in sql.lower()


def test_select_star_preview_is_not_an_nl2sql_base():
    assert _sql_is_unhelpful_history_base("SELECT * FROM accounts LIMIT 50") is True
    assert _sql_is_unhelpful_history_base(
        "SELECT date_trunc('month', created_at) AS period, COUNT(*) FROM accounts GROUP BY 1"
    ) is False
