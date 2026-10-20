from src.modules.workbooks.range_refresh import substitute_sql_parameters


def test_substitute_sql_parameters():
    sql = "SELECT * FROM t WHERE yr = {{ fiscal_year }}"
    out = substitute_sql_parameters(sql, {"fiscal_year": 2026})
    assert "2026" in out
    assert "{{" not in out
