"""Averages, rates and distinct counts are never totalled in the facts the narrator and the
number check treat as ground truth ("cumulative tenure 108 months" from three averages)."""

import pytest

from ee.modules.ai.nodes.insight_synthesizer_node import _compute_data_facts
from ee.modules.ai.utils.result_checks import non_additive_columns


@pytest.mark.parametrize(
    "sql, expected",
    [
        ("SELECT plan, region, AVG(tenure) AS avg_tenure, COUNT(*) AS n, SUM(fee) AS total_fee FROM c GROUP BY 1, 2",
         {"avg_tenure"}),
        ("SELECT plan, avg_fee FROM (SELECT plan, AVG(fee) AS avg_fee FROM c GROUP BY plan) t", {"avg_fee"}),
        ("WITH x AS (SELECT region, SUM(fee) / COUNT(*) AS fee_per_customer, COUNT(DISTINCT id) AS customers "
         "FROM c GROUP BY region) SELECT region, fee_per_customer, customers FROM x", {"fee_per_customer", "customers"}),
        ("SELECT month, SUM(amt) AS revenue, SUM(SUM(amt)) OVER (ORDER BY month) AS running FROM o GROUP BY month",
         {"running"}),
        ("SELECT region, ROUND(SUM(amt), 2) AS revenue, SUM(amt) - SUM(cost) AS profit, "
         "100.0 * SUM(churned) / COUNT(*) AS churn_pct FROM o GROUP BY region", {"churn_pct"}),
        ("SELECT * FROM orders", set()),
        ("not sql at all", set()),
        (None, set()),
    ],
)
def test_non_additive_columns_follow_the_sql(sql, expected):
    assert non_additive_columns(sql) == expected


ROWS = [
    {"plan": "Basic", "region": "Kandal", "avg_tenure": 36.2},
    {"plan": "Basic", "region": "Siem Reap", "avg_tenure": 35.9},
    {"plan": "Basic", "region": "Phnom Penh", "avg_tenure": 36.08},
    {"plan": "Plus", "region": "Kandal", "avg_tenure": 36.48},
    {"plan": "Plus", "region": "Siem Reap", "avg_tenure": 35.44},
    {"plan": "Plus", "region": "Phnom Penh", "avg_tenure": 36.14},
]
SQL = "SELECT plan, region, AVG(tenure_months) AS avg_tenure FROM customers GROUP BY plan, region"


def test_averages_get_no_totals_or_shares():
    facts = "\n".join(_compute_data_facts(ROWS, sql=SQL))
    assert "Total=" not in facts
    assert "108.18" not in facts  # Basic's three regional averages added up
    assert "%" not in facts.split("Top ")[0]  # no shares of a sum of averages
    assert "not additive" in facts
    assert "Basic=35.90–36.20" in facts


def test_additive_measures_keep_totals_and_shares():
    rows = [{"plan": "Basic", "total_fee": 300}, {"plan": "Plus", "total_fee": 100}]
    facts = "\n".join(_compute_data_facts(rows, sql="SELECT plan, SUM(fee) AS total_fee FROM c GROUP BY plan"))
    assert "Total=400" in facts
    assert "Basic=300 (75.0%)" in facts


def test_without_sql_behaviour_is_unchanged():
    facts = "\n".join(_compute_data_facts(ROWS))
    assert "Total=" in facts
