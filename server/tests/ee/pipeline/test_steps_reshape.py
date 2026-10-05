import os

os.environ.setdefault("AISER_EDITION", "enterprise")

import pytest


def _ctx():
    from src.modules.pipeline.transform.steps import CompileContext

    return CompileContext(index=1)


def test_derive_step_adds_computed_columns():
    from src.modules.pipeline.transform.steps import DeriveStep

    sql = DeriveStep(columns={"month": "date_trunc('month', order_date)"}).to_cte(
        "s0", _ctx()
    )
    assert sql == "SELECT *, date_trunc('month', order_date) AS \"month\" FROM s0"


def test_aggregate_step_groups_and_measures():
    from src.modules.pipeline.transform.steps import AggregateStep

    sql = AggregateStep(by=["region", "month"], sum=["amount"], count=["id"]).to_cte(
        "s0", _ctx()
    )
    assert sql == (
        'SELECT "region", "month", SUM("amount") AS "amount", COUNT("id") AS "id" '
        'FROM s0 GROUP BY "region", "month"'
    )


def test_aggregate_step_requires_at_least_one_measure():
    from src.modules.pipeline.transform.steps import AggregateStep

    with pytest.raises(ValueError, match="at least one measure"):
        AggregateStep(by=["region"])


def test_join_step_sql():
    from src.modules.pipeline.transform.steps import JoinStep

    sql = JoinStep(asset="dim_region", how="left", on={"region_id": "id"}).to_cte(
        "s0", _ctx()
    )
    assert sql == (
        'SELECT s0.*, j1.* EXCLUDE ("id") FROM s0 '
        'LEFT JOIN dim_region AS j1 ON s0."region_id" = j1."id"'
    )


def test_join_step_rejects_an_unknown_join_type():
    from src.modules.pipeline.transform.steps import JoinStep

    with pytest.raises(ValueError):
        JoinStep(asset="d", how="sideways", on={"a": "b"})


def test_pivot_step_uses_native_duckdb_pivot():
    from src.modules.pipeline.transform.steps import PivotStep

    sql = PivotStep(on="region", using="amount", agg="sum", group_by=["month"]).to_cte(
        "s0", _ctx()
    )
    assert sql == 'PIVOT s0 ON "region" USING sum("amount") GROUP BY "month"'


def test_unpivot_step_sql():
    from src.modules.pipeline.transform.steps import UnpivotStep

    sql = UnpivotStep(
        columns=["q1", "q2"], name_column="quarter", value_column="amount"
    ).to_cte("s0", _ctx())
    assert sql == 'UNPIVOT s0 ON "q1", "q2" INTO NAME "quarter" VALUE "amount"'


def test_scale_minmax_sql():
    from src.modules.pipeline.transform.steps import ScaleStep

    sql = ScaleStep(columns=["amount"], method="minmax").to_cte("s0", _ctx())
    assert 'MIN("amount") OVER ()' in sql
    assert 'MAX("amount") OVER ()' in sql
    assert "NULLIF(" in sql, "must not divide by zero on a constant column"


def test_scale_zscore_sql():
    from src.modules.pipeline.transform.steps import ScaleStep

    sql = ScaleStep(columns=["amount"], method="zscore").to_cte("s0", _ctx())
    assert 'AVG("amount") OVER ()' in sql
    assert 'STDDEV_POP("amount") OVER ()' in sql


def test_sql_step_is_a_verbatim_escape_hatch():
    from src.modules.pipeline.transform.steps import SqlStep

    sql = SqlStep(query="SELECT id, upper(name) AS name FROM {input}").to_cte(
        "s0", _ctx()
    )
    assert sql == "SELECT id, upper(name) AS name FROM s0"


def test_sql_step_requires_the_input_placeholder():
    from src.modules.pipeline.transform.steps import SqlStep

    with pytest.raises(ValueError, match=r"\{input\}"):
        SqlStep(query="SELECT * FROM some_other_table")
