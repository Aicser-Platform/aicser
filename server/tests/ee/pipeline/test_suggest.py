import os
from pathlib import Path

os.environ.setdefault("AISER_EDITION", "enterprise")

FIXTURES = Path(__file__).parent / "fixtures" / "onboarding"
ALL_FIXTURES = [
    "dirty_sales.csv",
    "duplicate_keys.csv",
    "all_null_column.csv",
    "clean.csv",
]


def _scan(name: str) -> str:
    path = str(FIXTURES / name).replace("'", "''")
    return f"SELECT * FROM read_csv_auto('{path}', all_varchar=true)"


def _findings(name: str, **kwargs):
    from src.modules.pipeline.profile.profiler import profile_object
    from src.modules.pipeline.profile.suggest import suggest_steps

    return suggest_steps(profile_object(_scan(name)), **kwargs)


def _by_code(findings, code):
    return [finding for finding in findings if finding.code == code]


def test_every_suggestion_from_every_fixture_parses_as_a_real_step():
    """The bridge test. If a step schema changes, this fails loudly."""
    from src.modules.pipeline.transform.steps import parse_step

    for fixture in ALL_FIXTURES:
        for finding in _findings(fixture):
            if finding.suggested_step is None:
                continue
            parse_step(finding.suggested_step)


def test_every_suggestion_also_compiles_to_sql():
    """`compile_transform` takes a TransformDoc, and `output` is a required field."""
    from src.modules.pipeline.transform.compiler import TransformDoc, compile_transform

    for fixture in ALL_FIXTURES:
        steps = [finding.suggested_step for finding in _findings(fixture) if finding.suggested_step]
        if not steps:
            continue
        doc = TransformDoc(
            version=1,
            transform=steps,
            output={"layer": "silver", "table": "t", "write_mode": "append"},
        )
        compiled = compile_transform(doc, source_sql="SELECT 1 AS order_id", limit=10)
        assert compiled.sql


def test_a_clean_file_produces_no_findings():
    assert _findings("clean.csv") == []


def test_duplicate_keys_suggest_dedupe_keyed_on_keys():
    findings = _by_code(_findings("duplicate_keys.csv"), "duplicate_keys")

    assert findings
    assert findings[0].suggested_step == {"dedupe": {"keys": ["customer_id"]}}


def test_null_tokens_suggest_clean_with_the_tokens_listed():
    findings = _by_code(_findings("all_null_column.csv"), "null_tokens")

    assert findings
    step = findings[0].suggested_step["clean"]
    assert step["columns"] == ["note"]
    assert step["trim"] is True
    assert "na" in [token.lower() for token in step["nulls"]]


def test_partially_parseable_columns_suggest_validate_with_the_chosen_policy():
    findings = _by_code(_findings("dirty_sales.csv", on_fail="warn"), "partially_parseable")

    assert findings
    assert findings[0].suggested_step == {
        "validate": {"not_null": ["order_date"], "on_fail": "warn"}
    }


def test_findings_carry_i18n_keys_not_prose():
    for finding in _findings("dirty_sales.csv"):
        assert finding.message_key.startswith("onboarding.finding.")
        assert " " not in finding.message_key


def test_severity_is_one_of_the_three_allowed_values():
    for finding in _findings("dirty_sales.csv"):
        assert finding.severity in ("info", "warning", "error")
