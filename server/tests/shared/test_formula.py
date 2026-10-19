import duckdb
import pytest

from src.shared.formula import FormulaError, translate

COLUMNS = ["Amount", "Name", "Registered", "Qty"]


def run(formula: str, language: str = "excel"):
    sql = translate(formula, language=language, columns=COLUMNS).sql
    conn = duckdb.connect()
    return conn.execute(
        f"SELECT {sql} FROM (VALUES (150.0, 'dara sok', DATE '2026-10-03', 3), (20.0, NULL, DATE '2026-01-31', 0)) "
        "t(\"Amount\", \"Name\", \"Registered\", \"Qty\")"
    ).fetchall()


def test_if_with_brackets_and_text():
    assert run('=IF([Amount] > 100, "High", "Low")') == [("High",), ("Low",)]


def test_bare_column_names_and_operators():
    assert run("Amount * Qty + 1") == [(451.0,), (1.0,)]


def test_division_by_zero_is_empty_not_an_error():
    assert run("[Amount] / [Qty]") == [(50.0,), (None,)]


def test_concat_ignores_empty():
    assert run('[Name] & " (" & [Qty] & ")"') == [("dara sok (3)",), (" (0)",)]


def test_text_functions():
    assert run("PROPER([Name])")[0] == ("Dara Sok",)
    assert run("LEFT([Name], 4)")[0] == ("dara",)
    assert run("ISBLANK([Name])") == [(False,), (True,)]


def test_dates():
    assert run("YEAR([Registered])") == [(2026,), (2026,)]
    assert run('TEXT([Registered], "dd-mmm-yyyy")')[0] == ("03-Oct-2026",)
    assert str(run("EOMONTH([Registered], 1)")[1][0]) == "2026-02-28"
    assert run('DATEDIF([Registered], DATE(2026, 12, 31), "m")')[0] == (2,)


def test_numbers_and_percent():
    assert run("ROUND([Amount] * 10%, 1)") == [(15.0,), (2.0,)]
    assert run('TEXT([Amount], "#,##0.00")')[0] == ("150.00",)


def test_sql_language_is_validated():
    assert translate('"Amount" * 2', language="sql").sql == '"Amount" * 2'
    with pytest.raises(FormulaError):
        translate("1; DROP TABLE x", language="sql")


@pytest.mark.parametrize(
    "bad,hint",
    [("[Amont] * 2", "no column"), ("IF([Amount] > 1", "ends too early"), ("FOO(1)", "isn't a supported"), ("Amont", "Unknown name")],
)
def test_helpful_errors(bad, hint):
    with pytest.raises(FormulaError) as err:
        translate(bad, columns=COLUMNS)
    assert hint in str(err.value)
