"""Prepare v2: steps that handle real-world mess, detection, and change reporting."""

import duckdb
import pytest

from src.modules.prep import detect, insights
from src.modules.prep.engine.executor import connect, preview_steps

SOURCE = """SELECT * FROM (VALUES
 (1, 'Dara Sok', '07 Oct 2026', '1,234.50', 'PAID', 'yes', ' KH-001 ', 'dara@example.com'),
 (2, 'Lina  Chan', '03-Oct-2026', '$99', 'paid', 'no', 'KH-002', 'lina@example.com'),
 (3, 'Sophea', '08-Sep-2026', '(45)', 'Paid', 'yes', 'KH-003', 'sophea@example.com'),
 (4, 'Vibol Kim Heng', '12 Sep 2026', '12%', 'UNPAID', 'no', 'KH-004', 'vibol@example.com')
) t(id, name, registered, amount, status, active, code, email)"""


def rows(steps):
    r = preview_steps(steps, source_sql=SOURCE, connection=connect())
    assert r["step_errors"] == [], r["step_errors"]
    return r["rows"]


def test_split_on_whitespace_keeps_the_rest_in_the_last_column():
    out = rows([{"split": {"column": "name", "mode": "whitespace", "into": ["first", "last"]}}])
    assert [(r["first"], r["last"]) for r in out] == [("Dara", "Sok"), ("Lina", "Chan"), ("Sophea", None), ("Vibol", "Kim Heng")]


def test_split_by_position_and_into_rows():
    out = rows([{"split": {"column": "code", "mode": "positions", "positions": [3], "into": ["prefix", "number"]}}])
    assert out[1]["prefix"] == "KH-" and out[1]["number"] == "002"
    assert len(rows([{"split": {"column": "name", "mode": "rows", "delimiter": " "}}])) == 8


def test_dates_in_mixed_formats_parse_together():
    out = rows([{"parse_date": {"columns": ["registered"], "formats": ["%d %b %Y", "%d-%b-%Y"]}}])
    assert [str(r["registered"]) for r in out] == ["2026-10-07", "2026-10-03", "2026-09-08", "2026-09-12"]


def test_smart_numbers():
    out = rows([{"parse_number": {"columns": ["amount"]}}])
    assert [r["amount"] for r in out] == [1234.5, 99.0, -45.0, 0.12]


def test_set_types_in_one_step():
    out = rows([{"set_types": {"columns": {
        "registered": {"type": "date", "formats": ["%d %b %Y", "%d-%b-%Y"]},
        "amount": {"type": "number"},
        "active": {"type": "boolean"},
    }}}])
    assert out[0]["active"] is True and out[1]["active"] is False
    assert out[2]["amount"] == -45.0


def test_replace_many_whole_values_ignoring_case():
    out = rows([{"replace": {"columns": ["status"], "mapping": {"paid": "Paid", "unpaid": "Unpaid"}, "match": "whole", "case_sensitive": False}}])
    assert {r["status"] for r in out} == {"Paid", "Unpaid"}


def test_change_case_and_fill_strategies():
    assert rows([{"change_case": {"columns": ["name"], "case": "upper"}}])[0]["name"] == "DARA SOK"
    filled = rows([{"replace": {"columns": ["code"], "find": "KH-002", "replace_with": "", "match": "whole"}},
                   {"clean": {"columns": ["code"], "nulls": [""]}},
                   {"fill": {"columns": ["code"], "strategy": "down"}}])
    assert filled[1]["code"] == " KH-001 "


def test_filter_rows_builder():
    keep = rows([{"filter_rows": {"conditions": [{"column": "status", "op": "equals", "value": "paid"}]}}])
    assert len(keep) == 3
    removed = rows([{"filter_rows": {"conditions": [{"column": "id", "op": "gt", "value": "2"}], "action": "remove"}}])
    assert [r["id"] for r in removed] == [1, 2]


def test_conditional_and_formula_columns():
    out = rows([
        {"parse_number": {"columns": ["amount"]}},
        {"conditional": {"into": "band", "rules": [{"conditions": [{"column": "amount", "op": "gte", "value": "100"}], "then": {"value": "Large"}}], "otherwise": {"value": "Small"}}},
        {"formula": {"into": "label", "expression": '=[name] & " #" & [id]'}},
        {"formula": {"into": "double_amount", "expression": '"amount" * 2', "language": "sql"}},
    ])
    assert [r["band"] for r in out] == ["Large", "Small", "Small", "Small"]
    assert out[0]["label"] == "Dara Sok #1" and out[0]["double_amount"] == 2469.0


def test_disabled_steps_do_nothing_but_keep_their_place():
    out = rows([{"drop": {"columns": ["email"], "disabled": True}}, {"drop": {"columns": ["code"]}}])
    assert "email" in out[0] and "code" not in out[0]


@pytest.fixture()
def conn():
    c = duckdb.connect()
    c.execute(f"CREATE TEMP VIEW src AS {SOURCE}")
    return c


def test_detects_mixed_date_formats_numbers_and_booleans(conn):
    found = detect.detect_types(conn, "src")
    assert found["registered"]["type"] == "date"
    assert set(found["registered"]["formats"]) == {"%d %b %Y", "%d-%b-%Y"}
    assert found["amount"]["type"] == "number"
    assert found["active"]["type"] == "boolean"
    assert "name" not in found and "id" not in found


def test_date_pattern_from_an_example():
    assert "%d-%b-%Y" in detect.formats_for_example("03-Oct-2026")
    assert detect.formats_for_example("31/12/2026")[0] == "%d/%m/%Y"


def test_step_stats_report_what_changed(conn):
    steps = [{"cast": {"columns": {"amount": "double"}}}, {"filter_rows": {"conditions": [{"column": "id", "op": "lte", "value": "2"}]}}]
    stats = insights.step_stats(conn, steps, "SELECT * FROM src")
    assert stats[0]["emptied"] == {"amount": 4}
    assert "amount" in stats[0]["retyped"]
    assert stats[1]["rows_delta"] == -2


def test_changes_highlight_cells(conn):
    changes = insights.step_changes(conn, [{"change_case": {"columns": ["status"], "case": "upper"}}], "SELECT * FROM src", 0, 10)
    assert changes["changed"] == {"status": [1, 2]}
    split = insights.step_changes(conn, [{"split": {"column": "name", "mode": "whitespace"}}], "SELECT * FROM src", 0, 10)
    assert split["added"] == ["name_1", "name_2"] and split["removed"] == ["name"]


def test_failed_values_lists_what_could_not_be_read(conn):
    values = insights.failed_values(conn, [{"cast": {"columns": {"amount": "double"}}}], "SELECT * FROM src", 0, "amount")
    assert {v["value"] for v in values} == {"1,234.50", "$99", "(45)", "12%"}


def test_suggestions_cover_types_spelling_personal_data_and_names(conn):
    codes = {f["code"] for f in insights.suggestions(conn, "src")}
    assert {"date_as_text", "number_as_text", "boolean_as_text", "inconsistent_values", "personal_email", "whitespace"} <= codes


def test_distributions(conn):
    dist = insights.distributions(conn, "src")
    assert dist["id"]["kind"] == "number" and len(dist["id"]["histogram"]) == 12
    assert dist["status"]["kind"] == "text" and dist["status"]["top"][0]["count"] == 1


def test_labels_with_a_number_are_not_numbers():
    c = duckdb.connect()
    c.execute("CREATE TEMP VIEW lv AS SELECT * FROM (VALUES ('EN-Grade 1'), ('EN-Grade 2'), ('KH-Grade 3'), ('EN-Grade 4')) t(level)")
    assert "level" not in detect.detect_types(c, "lv")
    c.execute("CREATE TEMP VIEW money AS SELECT * FROM (VALUES ('USD 1,200'), ('$5'), ('(30)'), ('12%')) t(amount)")
    assert detect.detect_types(c, "money")["amount"]["type"] == "number"
