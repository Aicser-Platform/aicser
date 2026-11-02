"""Readiness: messy sheets are spotted by their shape; tidy ones pass quietly."""

from src.modules.prep.readiness import shape_findings


def _codes(found):
    return [f["code"] for f in found]


def test_tidy_table_has_nothing_to_say():
    columns = ["region", "month", "sales"]
    rows = [["North", "2026-01", 120], ["South", "2026-01", 90]] * 12
    assert shape_findings(columns, rows) == []


def test_title_rows_above_a_two_row_header():
    columns = ["Quarterly report", "column1", "column2"]
    rows = [
        [None, None, None],
        ["Region", "Sales", "Sales"],
        ["", "2025", "2026"],
        ["North", 10, 12],
        ["South", 8, 9],
    ]
    rows[2] = ["Area", "2025", "2026"]  # numbers as text are not a header row
    found = shape_findings(columns, rows)
    step = found[0]["suggested_step"]["header_rows"]
    assert found[0]["code"] == "headers_below_title"
    assert step["skip"] == 1 and step["rows"] == 1
    assert step["names"] == {"Quarterly report": "Region", "column1": "Sales", "column2": "Sales 2"}


def test_two_header_rows_are_joined():
    columns = ["A", "B", "C"]
    rows = [["Report"] + [None, None], ["Region", "Revenue", "Revenue"], ["Name", "Plan", "Actual"], ["North", 1, 2]]
    step = shape_findings(columns, rows)[0]["suggested_step"]["header_rows"]
    assert step["skip"] == 1 and step["rows"] == 2
    assert step["names"] == {"A": "Region Name", "B": "Revenue Plan", "C": "Revenue Actual"}


def test_notes_under_the_data_and_empty_columns():
    columns = ["id", "amount", "spare", "owner"]
    rows = [[i, i * 10, None, "x"] for i in range(25)] + [["Prepared by finance", None, None, None]]
    found = shape_findings(columns, rows)
    assert _codes(found) == ["notes_below_data", "empty_columns"]
    assert found[0]["suggested_step"] == {"remove_rows": {"bottom": 1}}
    assert found[1]["suggested_step"] == {"drop": {"columns": ["spare"]}}
