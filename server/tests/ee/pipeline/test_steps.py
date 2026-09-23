import os

os.environ.setdefault("AISER_EDITION", "enterprise")

import pytest


def _ctx(index=1):
    from src.modules.pipeline.transform.steps import CompileContext

    return CompileContext(index=index)


def test_parse_step_reads_the_single_key_form():
    from src.modules.pipeline.transform.steps import SelectStep, parse_step

    step = parse_step({"select": {"columns": ["id", "amount"]}})
    assert isinstance(step, SelectStep)
    assert step.columns == ["id", "amount"]


def test_parse_step_rejects_an_unknown_kind():
    from src.modules.pipeline.transform.steps import parse_step

    with pytest.raises(ValueError, match="unknown transform step 'frobnicate'"):
        parse_step({"frobnicate": {}})


def test_parse_step_rejects_a_multi_key_mapping():
    from src.modules.pipeline.transform.steps import parse_step

    with pytest.raises(ValueError, match="exactly one key"):
        parse_step({"select": {"columns": ["a"]}, "drop": {"columns": ["b"]}})


def test_select_step_sql():
    from src.modules.pipeline.transform.steps import SelectStep

    sql = SelectStep(columns=["id", "amount"]).to_cte("s0", _ctx())
    assert sql == 'SELECT "id", "amount" FROM s0'


def test_drop_step_uses_exclude():
    from src.modules.pipeline.transform.steps import DropStep

    sql = DropStep(columns=["tmp", "note"]).to_cte("s0", _ctx())
    assert sql == 'SELECT * EXCLUDE ("tmp", "note") FROM s0'


def test_rename_step_sql():
    from src.modules.pipeline.transform.steps import RenameStep

    sql = RenameStep(columns={"amt": "amount"}).to_cte("s0", _ctx())
    assert sql == 'SELECT * RENAME ("amt" AS "amount") FROM s0'


def test_sort_step_defaults_to_ascending_and_honours_direction():
    from src.modules.pipeline.transform.steps import SortStep

    assert (
        SortStep(by=["region"]).to_cte("s0", _ctx())
        == 'SELECT * FROM s0 ORDER BY "region" ASC'
    )
    assert (
        SortStep(by=["amount"], desc=True).to_cte("s0", _ctx())
        == 'SELECT * FROM s0 ORDER BY "amount" DESC'
    )


def test_limit_step_sql():
    from src.modules.pipeline.transform.steps import LimitStep

    assert LimitStep(n=50).to_cte("s0", _ctx()) == "SELECT * FROM s0 LIMIT 50"


def test_quote_ident_rejects_an_embedded_quote():
    """Identifiers come from user YAML; a quote must never break out of the identifier."""
    from src.modules.pipeline.transform.steps import quote_ident

    with pytest.raises(ValueError, match="invalid identifier"):
        quote_ident('bad"name')
