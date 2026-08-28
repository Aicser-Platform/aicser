import os

os.environ.setdefault("AISER_EDITION", "enterprise")

import pytest


def _ctx():
    from src.modules.pipeline.transform.steps import CompileContext

    return CompileContext(index=1)


def test_filter_step_sql():
    from src.modules.pipeline.transform.steps import FilterStep

    sql = FilterStep(where="status <> 'test'").to_cte("s0", _ctx())
    assert sql == "SELECT * FROM s0 WHERE status <> 'test'"


def test_filter_step_rejects_a_statement_terminator():
    """The where clause is raw user SQL; it must not smuggle in a second statement."""
    from src.modules.pipeline.transform.steps import FilterStep

    with pytest.raises(ValueError, match="single boolean expression"):
        FilterStep(where="1=1; DROP TABLE users")


def test_cast_step_uses_try_cast_so_bad_rows_become_null_not_errors():
    from src.modules.pipeline.transform.steps import CastStep

    sql = CastStep(columns={"order_date": "date", "amount": "decimal(18,2)"}).to_cte(
        "s0", _ctx()
    )
    assert sql == (
        "SELECT * REPLACE ("
        'TRY_CAST("order_date" AS date) AS "order_date", '
        'TRY_CAST("amount" AS decimal(18,2)) AS "amount"'
        ") FROM s0"
    )


def test_cast_step_rejects_an_unknown_type():
    from src.modules.pipeline.transform.steps import CastStep

    with pytest.raises(ValueError, match="unsupported cast type"):
        CastStep(columns={"x": "; DROP TABLE t"})


def test_clean_step_normalises_null_tokens_and_trims():
    from src.modules.pipeline.transform.steps import CleanStep

    sql = CleanStep(columns=["region"], nulls=["N/A", "-"], trim=True).to_cte(
        "s0", _ctx()
    )
    assert "NULLIF(NULLIF(TRIM(\"region\"), 'N/A'), '-')" in sql
    assert sql.startswith("SELECT * REPLACE (")


def test_clean_step_strips_currency_symbols_and_separators():
    from src.modules.pipeline.transform.steps import CleanStep

    sql = CleanStep(columns=["amount"], currency=True).to_cte("s0", _ctx())
    assert "regexp_replace" in sql
    assert "[$,%\\s]" in sql or "[$,%[:space:]]" in sql


def test_fill_na_step_sql():
    from src.modules.pipeline.transform.steps import FillNaStep

    sql = FillNaStep(values={"amount": 0}).to_cte("s0", _ctx())
    assert sql == 'SELECT * REPLACE (COALESCE("amount", 0) AS "amount") FROM s0'


def test_dedupe_step_keeps_the_first_row_per_key():
    from src.modules.pipeline.transform.steps import DedupeStep

    sql = DedupeStep(keys=["id"], order_by="updated_at", keep="last").to_cte(
        "s0", _ctx()
    )
    assert 'ROW_NUMBER() OVER (PARTITION BY "id" ORDER BY "updated_at" DESC)' in sql
    assert "WHERE _rn = 1" in sql


def test_dedupe_step_without_keys_is_a_distinct():
    from src.modules.pipeline.transform.steps import DedupeStep

    assert DedupeStep().to_cte("s0", _ctx()) == "SELECT DISTINCT * FROM s0"
