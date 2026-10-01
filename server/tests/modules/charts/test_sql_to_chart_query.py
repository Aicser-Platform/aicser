from src.modules.charts.services.sql_to_chart_query import structure_sql

SCHEMA = {
    "tables": [
        {
            "name": "orders",
            "columns": [
                {"name": "order_id", "nullable": False},
                {"name": "order_date"},
                {"name": "store_id"},
                {"name": "order_total"},
                {"name": "status"},
                {"name": "region"},
            ],
        }
    ]
}


def test_grouped_total_with_filters_order_and_limit():
    q = structure_sql(
        "SELECT region, SUM(order_total) AS total_sales FROM orders "
        "WHERE status = 'paid' AND order_date >= '2024-01-01' GROUP BY region ORDER BY total_sales DESC LIMIT 10",
        SCHEMA,
    )
    assert q["tableName"] == "orders" and q["x"] == "region"
    assert q["yMetrics"] == [{"field": "order_total", "aggregation": "sum", "label": "Total Sales"}]
    assert {"field": "status", "operator": "=", "value": "paid"} in q["filters"]
    assert (q["sortBy"], q["sortOrder"], q["limit"]) == ("y", "desc", 10)


def test_monthly_trend_keeps_its_date_grain():
    q = structure_sql(
        "SELECT DATE_TRUNC('month', order_date) AS month, SUM(order_total) FROM orders GROUP BY 1 ORDER BY 1", SCHEMA
    )
    assert (q["x"], q["xGrain"], q["sortBy"], q["sortOrder"]) == ("order_date", "month", "x", "asc")


def test_count_star_uses_a_never_null_column():
    q = structure_sql("SELECT region, COUNT(*) AS orders FROM orders GROUP BY region", SCHEMA)
    assert q["yMetrics"][0]["field"] == "order_id" and q["yMetrics"][0]["aggregation"] == "count"


def test_between_and_in_become_filters():
    q = structure_sql(
        "SELECT region, COUNT(DISTINCT store_id) FROM orders "
        "WHERE order_date BETWEEN '2024-01-01' AND '2024-12-31' AND region IN ('N', 'S') GROUP BY region",
        SCHEMA,
    )
    ops = {(f["field"], f["operator"]) for f in q["filters"]}
    assert ops == {("order_date", ">="), ("order_date", "<="), ("region", "in")}
    assert q["yMetrics"][0]["aggregation"] == "distinct_count"


def test_shapes_without_an_exact_equivalent_stay_sql():
    for sql in [
        "SELECT o.region, SUM(o.order_total) FROM orders o JOIN stores s ON s.store_id = o.store_id GROUP BY 1",
        "WITH a AS (SELECT * FROM orders) SELECT region, SUM(order_total) FROM a GROUP BY region",
        "SELECT region, SUM(order_total) FROM orders GROUP BY region HAVING SUM(order_total) > 5",
        "SELECT region, SUM(order_total) / COUNT(*) FROM orders GROUP BY region",
        "SELECT region, SUM(order_total) FROM orders WHERE status = 'paid' OR region = 'N' GROUP BY region",
        "SELECT region, SUM(missing_col) FROM orders GROUP BY region",
        "SELECT region, SUM(order_total) FROM unknown_table GROUP BY region",
    ]:
        assert structure_sql(sql, SCHEMA) is None, sql
