import os

os.environ.setdefault("AISER_EDITION", "enterprise")

import pytest


def _ctx():
    from src.modules.pipeline.transform.steps import CompileContext

    return CompileContext(index=1)


def test_not_null_predicate():
    from src.modules.pipeline.transform.steps import ValidateStep

    step = ValidateStep(not_null=["id"])
    assert step.predicate_sql() == '("id" IS NOT NULL)'


def test_multiple_rules_are_anded():
    from src.modules.pipeline.transform.steps import ValidateStep

    step = ValidateStep(not_null=["id"], range={"amount": [0, 100]})
    pred = step.predicate_sql()
    assert '("id" IS NOT NULL)' in pred
    assert '("amount" BETWEEN 0 AND 100)' in pred
    assert " AND " in pred


def test_accepted_values_and_regex_predicates():
    from src.modules.pipeline.transform.steps import ValidateStep

    step = ValidateStep(
        accepted_values={"status": ["open", "closed"]},
        regex={"code": "^[A-Z]{3}$"},
    )
    pred = step.predicate_sql()
    assert "\"status\" IN ('open', 'closed')" in pred
    assert "regexp_matches(\"code\", '^[A-Z]{3}$')" in pred


def test_unique_uses_a_window_count():
    from src.modules.pipeline.transform.steps import ValidateStep

    step = ValidateStep(unique=["id"])
    assert 'COUNT(*) OVER (PARTITION BY "id") = 1' in step.predicate_sql()


def test_warn_mode_passes_every_row_through():
    from src.modules.pipeline.transform.steps import ValidateStep

    sql = ValidateStep(not_null=["id"], on_fail="warn").to_cte("s0", _ctx())
    assert sql == "SELECT * FROM s0", "warn must not drop rows"


def test_quarantine_mode_keeps_only_passing_rows():
    from src.modules.pipeline.transform.steps import ValidateStep

    sql = ValidateStep(not_null=["id"], on_fail="quarantine").to_cte("s0", _ctx())
    assert sql == 'SELECT * FROM s0 WHERE ("id" IS NOT NULL)'


def test_quarantine_side_query_selects_failing_rows_with_a_reason():
    from src.modules.pipeline.transform.steps import ValidateStep

    step = ValidateStep(not_null=["id"], unique=["id"], on_fail="quarantine")
    sql = step.quarantine_cte("s0", _ctx())

    assert sql.startswith("SELECT *, ")
    assert "_quarantine_reason" in sql
    assert "WHERE NOT (" in sql
    assert "not_null:id" in sql


def test_fail_mode_raises_via_the_error_function():
    from src.modules.pipeline.transform.steps import ValidateStep

    sql = ValidateStep(not_null=["id"], on_fail="fail").to_cte("s0", _ctx())
    assert "error(" in sql
    assert "CASE WHEN" in sql


def test_validate_requires_at_least_one_rule():
    from src.modules.pipeline.transform.steps import ValidateStep

    with pytest.raises(ValueError, match="at least one rule"):
        ValidateStep()
