import os

os.environ.setdefault("AISER_EDITION", "enterprise")

import duckdb

YAML = """
version: 1
source: {asset: bronze.orders}
transform:
  - filter: {where: "status <> 'test'"}
  - cast: {amount: "decimal(18,2)"}
  - derive: {doubled: "amount * 2"}
output: {layer: silver, table: orders, write_mode: append}
"""

SOURCE_SQL = """
SELECT * FROM (VALUES
  (1, 'ok',   '10.5'),
  (2, 'test', '20.0'),
  (3, 'ok',   'oops')
) AS t(id, status, amount)
"""


def test_execute_transform_returns_an_arrow_table():
    from src.modules.pipeline.transform.compiler import (compile_transform,
                                                         parse_yaml)
    from src.modules.pipeline.transform.executor import execute_transform

    compiled = compile_transform(parse_yaml(YAML), source_sql=SOURCE_SQL)
    table = execute_transform(compiled, connection=duckdb.connect())

    assert table.num_rows == 2, "the 'test' row is filtered out"
    assert "doubled" in table.schema.names


def test_try_cast_turns_a_bad_value_into_null_rather_than_failing():
    """This is the behaviour that retires the date_trunc(VARCHAR) bug class."""
    from src.modules.pipeline.transform.compiler import (compile_transform,
                                                         parse_yaml)
    from src.modules.pipeline.transform.executor import execute_transform

    compiled = compile_transform(parse_yaml(YAML), source_sql=SOURCE_SQL)
    table = execute_transform(compiled, connection=duckdb.connect())

    amounts = table.column("amount").to_pylist()
    assert None in amounts, "'oops' must become NULL, not raise"


def test_preview_returns_columns_rows_and_sql():
    from src.modules.pipeline.transform.executor import preview_transform

    resp = preview_transform(
        YAML,
        source_sql=SOURCE_SQL,
        up_to_step=None,
        limit=10,
        connection=duckdb.connect(),
    )

    assert [c.name for c in resp.columns] == [
        "id",
        "status",
        "amount",
        "doubled",
    ]
    assert len(resp.rows) == 2
    assert resp.sql.startswith("WITH ")
    assert resp.step_errors == []


def test_preview_up_to_step_stops_before_later_steps():
    from src.modules.pipeline.transform.executor import preview_transform

    resp = preview_transform(
        YAML,
        source_sql=SOURCE_SQL,
        up_to_step=0,
        limit=10,
        connection=duckdb.connect(),
    )

    assert "doubled" not in [c.name for c in resp.columns]
    assert len(resp.rows) == 2


def test_preview_reports_a_step_error_instead_of_raising():
    from src.modules.pipeline.transform.executor import preview_transform

    bad = YAML.replace(
        '- cast: {amount: "decimal(18,2)"}',
        '- cast: {amount: "nonsense_type"}',
    )
    resp = preview_transform(
        bad,
        source_sql=SOURCE_SQL,
        up_to_step=None,
        limit=10,
        connection=duckdb.connect(),
    )

    assert resp.step_errors
    assert resp.step_errors[0].step == 1
    assert "unsupported cast type" in resp.step_errors[0].message
    assert resp.rows == []
