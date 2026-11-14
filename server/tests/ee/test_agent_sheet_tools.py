"""Sheet tools on a real workbook: live summaries, formatting, references and ranges."""

import pytest

ironcalc = pytest.importorskip("ironcalc")

from src.modules.ai import agent_sheet_tools as S  # noqa: E402


def _book():
    m = ironcalc.create("Book", "en", "UTC", "en")
    rows = [("region", "product", "sales"), ("North", "A", 10), ("South", "A", 5), ("North", "B", 7), ("South", "B", 3), ("North", "A", 1)]
    for r, row in enumerate(rows, start=1):
        for c, v in enumerate(row, start=1):
            m.set_user_input(0, r, c, str(v))
    m.evaluate()
    return m


def test_live_summary_formulas_compute_the_right_totals():
    m = _book()
    plan = S._summary_plan(m, {"source_range": "A1:C6", "group_by": "region", "across": "product",
                               "values": [{"column": "sales", "agg": "sum"}]})
    m.new_sheet()
    cells = S._summary_cells(plan, 1, 1)
    for r, c, v in cells:
        m.set_user_input(1, r, c, v)
    m.evaluate()
    grid = {(r, c): m.get_formatted_cell_value(1, r, c) for r, c, _ in cells}
    assert grid[(1, 2)] == "sum of sales · A" and grid[(2, 1)] == "North"
    assert (grid[(2, 2)], grid[(2, 3)], grid[(3, 2)], grid[(3, 3)]) == ("11", "7", "5", "3")
    assert m.get_cell_formula(1, 2, 2).startswith("=SUMIFS(")


def test_unknown_column_is_named():
    with pytest.raises(S.ToolError, match="Columns: region, product, sales"):
        S._summary_plan(_book(), {"source_range": "A1:C6", "group_by": "branch", "values": [{"column": "sales"}]})


def test_formatting_changes_only_what_was_asked():
    m = _book()
    style = S._styled(m.get_cell_style(0, 2, 3), {"number_format": "#,##0.00", "bold": True, "fill_color": "#ffeeaa"})
    m.set_cell_style(0, 2, 3, style)
    got = m.get_cell_style(0, 2, 3)
    assert got["num_fmt"] == "#,##0.00" and got["font"]["b"] is True and got["fill"]["color"] == "#FFEEAA"
    assert m.get_formatted_cell_value(0, 2, 3) == "10.00"
    with pytest.raises(S.ToolError):
        S._check_format({"font_color": "red"})


def test_references_and_ranges():
    assert S._refs("=SUM(Sheet2!A1:B3)+C5*'My Sheet'!$D$2") == ["Sheet2!A1:B3", "C5", "'My Sheet'!$D$2"]
    assert S._split_sheet("'My Sheet'!$D$2") == ("My Sheet", "$D$2")
    assert S._range("B:C", (1, 40, 1, 9)) == (1, 2, 40, 3)
    assert S._range("C5:A1") == (1, 1, 5, 3)
