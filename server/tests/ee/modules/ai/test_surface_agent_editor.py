"""Changes the notebook / workbook assistant proposes are checked against the open artifact and
the data it may use before the browser shows them."""

from ee.modules.ai.surface_agent.editor import (
    _tables_of,
    changes_action,
    split_answer_and_changes,
    validate_notebook_changes,
    validate_sheet_changes,
)

CATALOG = [{"id": "ds1", "name": "Sales", "engine": "postgresql",
            "tables": [{"name": "public.orders", "columns": [{"name": "id"}, {"name": "region"}, {"name": "amount"}]}]}]
NOTEBOOK = {"notebook_cells": [
    {"id": "c1", "cell_type": "sql", "name": "q1", "data_source_id": "ds1"},
    {"id": "c2", "cell_type": "markdown", "name": None},
]}
WORKBOOK = {"workbook_sheets": [{"name": "Sheet1"}], "active_sheet_name": "Sheet1"}


def test_reply_and_changes_are_separated():
    text = 'I will add a regional summary.\n```changes\n{"add": [{"cell_type": "markdown", "source": "# Regions"}]}\n```'
    answer, changes = split_answer_and_changes(text)
    assert answer == "I will add a regional summary."
    assert changes == {"add": [{"cell_type": "markdown", "source": "# Regions"}]}
    assert split_answer_and_changes("Just an answer.") == ("Just an answer.", None)


def test_notebook_changes_keep_real_cells_tables_and_safe_sql():
    proposed = {
        "add": [
            {"after_cell_id": "c1", "cell_type": "sql", "name": "by region", "data_source_id": "ds1",
             "source": "SELECT region, SUM(amount) AS total FROM orders GROUP BY region LIMIT 100"},
            {"cell_type": "sql", "name": "made_up", "data_source_id": "ds1", "source": "SELECT * FROM your_table LIMIT 10"},
            {"cell_type": "sql", "name": "unsafe", "data_source_id": "ds1", "source": "DROP TABLE orders"},
        ],
        "edit": [{"cell_id": "c1", "source": "SELECT id, amount FROM public.orders LIMIT 50"}, {"cell_id": "nope", "source": "x"}],
        "delete": ["c2", "ghost"],
        "run": ["c1", "by_region", "c2"],
    }
    checked, notes = validate_notebook_changes(proposed, NOTEBOOK, CATALOG, "ds1")
    assert [a["name"] for a in checked["add"]] == ["by_region"]
    assert checked["add"][0]["after_cell_id"] == "c1" and checked["add"][0]["data_source_id"] == "ds1"
    assert checked["edit"] == [{"cell_id": "c1", "source": "SELECT id, amount FROM public.orders LIMIT 50"}]
    assert checked["delete"] == ["c2"]
    assert checked["run"] == ["c1", "by_region"]  # a deleted cell is not run
    assert any("your_table" in n for n in notes) and any("unsafe" in n for n in notes)


def test_sheet_changes_need_real_tabs_cells_and_formulas():
    proposed = {
        "sheets": [{"name": "Summary"}, {"name": "Sheet1"}, {"name": "bad/name"}],
        "ranges": [
            {"name": "orders", "sql": "SELECT region, amount FROM orders LIMIT 5000", "data_source_id": "ds1", "sheet": "Summary", "anchor": "a1"},
            {"name": "ghost", "sql": "SELECT * FROM missing LIMIT 5", "data_source_id": "ds1", "sheet": "Summary", "anchor": "A1"},
        ],
        "writes": [
            {"sheet": "Summary", "cell": "e1", "formula": "SUM(B2:B200)"},
            {"sheet": "Summary", "cell": "D1", "value": "Total"},
            {"sheet": "Nowhere", "cell": "A1", "value": 1},
            {"sheet": "Summary", "cell": "not a cell", "value": 1},
        ],
        "charts": [{"sheet": "Summary", "range": "a1:b13", "chart_type": "radar", "title": "By region"}],
    }
    checked, notes = validate_sheet_changes(proposed, WORKBOOK, CATALOG, "ds1")
    assert checked["sheets"] == [{"name": "Summary"}]
    assert [r["name"] for r in checked["ranges"]] == ["orders"] and checked["ranges"][0]["anchor"] == "A1"
    assert checked["writes"] == [
        {"sheet": "Summary", "cell": "E1", "formula": "=SUM(B2:B200)"},
        {"sheet": "Summary", "cell": "D1", "value": "Total"},
    ]
    assert checked["charts"] == [{"sheet": "Summary", "range": "A1:B13", "chart_type": "bar", "title": "By region"}]
    assert any("missing" in n for n in notes)


def test_change_set_is_one_reviewable_action():
    action = changes_action("sheet", {"writes": [{"sheet": "S", "cell": "A1", "value": 1}]}, ["note"])
    assert action == {"type": "sheet_changes", "writes": [{"sheet": "S", "cell": "A1", "value": 1}], "notes": ["note"]}
    assert changes_action("notebook", {}, []) is None


def test_stored_schemas_in_several_shapes():
    assert _tables_of({"tables": [{"name": "orders", "schema": "sales", "columns": [{"name": "id", "type": "int"}]}]}) == [
        {"name": "sales.orders", "columns": [{"name": "id", "type": "int"}]}
    ]
    assert _tables_of({"tables": {"orders": ["id", "amount"]}})[0]["columns"][1]["name"] == "amount"
    assert _tables_of('{"schemas": [{"tables": [{"name": "t", "columns": []}]}]}')[0]["name"] == "t"
    assert _tables_of(None) == []
