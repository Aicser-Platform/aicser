"""New preparation steps, run end to end in DuckDB."""

import pytest

from src.modules.prep.engine.executor import connect, preview_steps

SOURCE = (
    "SELECT * FROM (VALUES "
    "(1, 'Dara, Sok', '  KH-001 ', '2026-01-15', '{\"city\":\"Phnom Penh\",\"tags\":[\"a\",\"b\"]}', '012345678'), "
    "(2, 'Lina, Chan', 'KH-002', 'not a date', '{\"city\":\"Siem Reap\",\"tags\":[\"c\"]}', '098765432')"
    ") AS t(id, full_name, code, joined, profile, phone)"
)


def run(steps):
    result = preview_steps(steps, source_sql=SOURCE, connection=connect())
    assert result["step_errors"] == [], result["step_errors"]
    return result["rows"]


def test_split_into_columns_drops_original():
    rows = run([{"split": {"column": "full_name", "delimiter": ",", "into": ["first", "last"]}}])
    assert rows[0]["first"] == "Dara" and rows[0]["last"] == "Sok"
    assert "full_name" not in rows[0]


def test_replace_literal_and_regex():
    rows = run([{"replace": {"columns": ["code"], "find": "KH-", "replace_with": ""}}])
    assert rows[1]["code"] == "002"
    rows = run([{"replace": {"columns": ["code"], "find": "\\s+", "replace_with": "", "regex": True}}])
    assert rows[0]["code"] == "KH-001"


def test_extract_number():
    rows = run([{"extract": {"column": "code", "pattern": "(\\d+)", "into": "code_no", "group_index": 1}}])
    assert rows[0]["code_no"] == "001"


def test_parse_date_bad_values_become_empty():
    rows = run([{"parse_date": {"columns": ["joined"], "format": "%Y-%m-%d"}}])
    assert str(rows[0]["joined"]) == "2026-01-15"
    assert rows[1]["joined"] is None


def test_concat():
    rows = run([{"concat": {"columns": ["id", "code"], "into": "label", "separator": "-"}}])
    assert rows[1]["label"] == "2-KH-002"


@pytest.mark.parametrize("method,expected", [("last4", "*****5678"), ("redact", "[redacted]")])
def test_mask(method, expected):
    rows = run([{"mask": {"columns": ["phone"], "method": method}}])
    assert rows[0]["phone"] == expected


def test_mask_hash_is_stable_and_hides_value():
    rows = run([{"mask": {"columns": ["phone"], "method": "hash"}}])
    assert rows[0]["phone"] != "012345678" and len(rows[0]["phone"]) == 32


def test_flatten_json_fields():
    rows = run([{"flatten_json": {"column": "profile", "fields": {"city": "$.city"}}}])
    assert [r["city"] for r in rows] == ["Phnom Penh", "Siem Reap"]
    assert "profile" not in rows[0]


def test_explode_json_array():
    rows = run(
        [
            {"flatten_json": {"column": "profile", "fields": {"tags": "$.tags"}, "keep_original": False}},
            {"explode": {"column": "tags"}},
        ]
    )
    assert len(rows) == 3


def test_invalid_json_path_is_rejected_with_step_number():
    result = preview_steps(
        [{"flatten_json": {"column": "profile", "fields": {"x": "city'; DROP"}}}],
        source_sql=SOURCE,
        connection=connect(),
    )
    assert result["step_errors"][0]["step"] == 0


def test_preview_up_to_step_stops_early():
    steps = [
        {"split": {"column": "full_name", "delimiter": ",", "into": ["first", "last"]}},
        {"drop": {"columns": ["first"]}},
    ]
    result = preview_steps(steps, source_sql=SOURCE, up_to_step=0, connection=connect())
    assert "first" in result["rows"][0]


def test_missing_column_errors_are_plain():
    result = preview_steps([{"set_types": {"columns": {"Unnamed: 3": {"type": "boolean"}}}}], source_sql=SOURCE, connection=connect())
    assert result["step_errors"][0]["message"].startswith('There is no column "Unnamed: 3"')


def test_error_points_at_the_step_that_breaks():
    steps = [{"drop": {"columns": ["code"]}}, {"change_case": {"columns": ["full_name"], "case": "upper"}},
             {"cast": {"columns": {"code": "varchar"}}}, {"drop": {"columns": ["phone"]}}]
    result = preview_steps(steps, source_sql=SOURCE, connection=connect())
    assert result["step_errors"][0]["step"] == 2
