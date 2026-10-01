from ee.scripts.repair_chart_groupings import repair_query

SCHEMA = {"tables": [{"name": "loans", "columns": [
    {"name": "loan_id", "type": "BIGINT"}, {"name": "branch_id", "type": "BIGINT"},
    {"name": "npl_flag", "type": "BOOLEAN"}, {"name": "outstanding_principal", "type": "DOUBLE"}]}]}


def test_title_grouping_resolved_through_foreign_key():
    q = {"tableName": "loans", "x": "npl_flag", "drillPath": ["npl_flag"],
         "filters": [{"field": "npl_flag", "operator": "=", "value": "Y"}]}
    new, changes = repair_query("NPL Outstanding by Branch", q, SCHEMA)
    assert new["x"] == "branch_id" and new["drillPath"] == ["branch_id"]
    assert new["filters"][0]["value"] is True
    assert len(changes) == 2 and q["x"] == "npl_flag"  # input untouched


def test_matching_or_unresolvable_grouping_left_alone():
    assert repair_query("Outstanding by Npl Flag", {"tableName": "loans", "x": "npl_flag"}, SCHEMA)[1] == []
    assert repair_query("Outstanding by Cohort", {"tableName": "loans", "x": "npl_flag"}, SCHEMA)[1] == []
    assert repair_query("Outstanding by Branch", {"tableName": "other", "x": "npl_flag"}, SCHEMA)[1] == []


def test_daily_trend_gets_monthly_grain_and_time_order():
    schema = {"tables": [{"name": "loans", "columns": [
        {"name": "disbursement_date", "type": "DATE"}, {"name": "principal", "type": "DOUBLE"}]}]}
    q = {"tableName": "loans", "x": "disbursement_date", "sortBy": "y", "sortOrder": "desc", "limit": 15}
    new, changes = repair_query("Principal over Time", q, schema, "line")
    assert new["xGrain"] == "month" and new["sortBy"] == "x" and new["sortOrder"] == "asc" and "limit" not in new
    assert repair_query("Principal by Month", {**new}, schema, "line")[1] == []
    assert repair_query("Principal", {"tableName": "loans", "x": "disbursement_date"}, schema, "bar")[1] == []


def test_rates_are_averaged_not_summed():
    schema = {"tables": [{"name": "loans", "columns": [{"name": "interest_rate", "type": "DOUBLE"},
                                                        {"name": "principal", "type": "DOUBLE"}]}]}
    q = {"tableName": "loans", "x": "branch", "yMetrics": [{"field": "interest_rate", "aggregation": "sum"},
                                                            {"field": "principal", "aggregation": "sum"}]}
    new, _ = repair_query("Rate by branch", q, schema, "bar")
    assert [m["aggregation"] for m in new["yMetrics"]] == ["avg", "sum"]


def test_fanout_join_is_removed_from_saved_sql():
    from ee.scripts.repair_chart_groupings import repair_fanout_sql

    schema = {"tables": [
        {"name": "loans", "rowCount": 500, "columns": [{"name": "loan_id"}, {"name": "branch_id"}]},
        {"name": "branches", "rowCount": 5, "columns": [{"name": "branch_id"}, {"name": "name"}]},
        {"name": "transactions", "rowCount": 5000, "columns": [{"name": "transaction_id"}, {"name": "branch_id"}]},
    ]}
    sql = ('SELECT d0."name" AS "name", d1."transaction_type" AS "transaction_type", SUM(f."principal_amount") AS t, '
           'SUM(f."interest_rate") AS r FROM "loans" f LEFT JOIN "branches" d0 ON f."branch_id" = d0."branch_id" '
           'LEFT JOIN "transactions" d1 ON f."branch_id" = d1."branch_id" GROUP BY d0."name", d1."transaction_type" '
           'ORDER BY 3 DESC LIMIT 50')
    out, changes = repair_fanout_sql(sql, schema)
    assert "transactions" not in out and "branches" in out
    assert "AVG" in out and any("fan-out" in c for c in changes)
