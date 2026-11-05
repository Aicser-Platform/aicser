"""Calculations across rows, ranges, index, top N, expand/split into rows, similar-match joins and
messy-sheet helpers — run end to end in DuckDB."""

import pytest

from src.modules.prep.engine.executor import connect, preview_steps

SALES = (
    "SELECT * FROM (VALUES "
    "('North', 1, 100.0), ('North', 2, 150.0), ('North', 3, 50.0), "
    "('South', 1, 300.0), ('South', 2, 200.0)"
    ") AS t(region, month, amount)"
)


def run(steps, source=SALES, limit=200):
    result = preview_steps(steps, source_sql=source, connection=connect(), limit=limit)
    assert result["step_errors"] == [], result["step_errors"]
    return result["rows"]


def by(rows, *keys):
    return sorted(rows, key=lambda r: tuple(r[k] for k in keys))


def test_running_total_and_previous_value_per_group():
    rows = by(run([
        {"window": {"calc": "running_total", "column": "amount", "into": "running", "partition_by": ["region"], "order_by": "month"}},
        {"window": {"calc": "previous", "column": "amount", "into": "prev", "partition_by": ["region"], "order_by": "month"}},
        {"window": {"calc": "difference", "column": "amount", "into": "change", "partition_by": ["region"], "order_by": "month"}},
    ]), "region", "month")
    assert [r["running"] for r in rows] == [100, 250, 300, 300, 500]
    assert [r["prev"] for r in rows] == [None, 100, 150, None, 300]
    assert rows[1]["change"] == 50


def test_rank_share_of_total_and_moving_average():
    rows = by(run([
        {"window": {"calc": "rank", "column": "amount", "into": "rank"}},
        {"window": {"calc": "percent_of_total", "column": "amount", "into": "share", "partition_by": ["region"]}},
        {"window": {"calc": "moving_average", "column": "amount", "into": "avg2", "order_by": "month", "size": 2,
                    "partition_by": ["region"]}},
    ]), "region", "month")
    assert {r["amount"]: r["rank"] for r in rows}[300.0] == 1
    assert round(rows[0]["share"], 3) == round(100 / 300, 3)
    assert rows[1]["avg2"] == 125


def test_ranges_at_boundaries_equal_width_and_quantiles():
    rows = by(run([{"bin": {"column": "amount", "into": "band", "edges": [100, 200]}}]), "amount")
    assert [r["band"] for r in rows] == ["< 100", "100 – 200", "100 – 200", "≥ 200", "≥ 200"]
    rows = run([{"bin": {"column": "amount", "into": "q", "mode": "quantiles", "count": 2}}])
    assert sorted({r["q"] for r in rows}) == [1, 2]
    rows = run([{"bin": {"column": "amount", "into": "w", "mode": "equal_width", "count": 5}}])
    assert all(" – " in r["w"] for r in rows)


def test_index_and_top_n_per_group():
    rows = run([{"index": {"into": "n"}}])
    assert [r["n"] for r in rows] == [1, 2, 3, 4, 5]
    rows = by(run([{"top_n": {"n": 1, "order_by": "amount", "partition_by": ["region"]}}]), "region")
    assert [(r["region"], r["amount"]) for r in rows] == [("North", 150.0), ("South", 300.0)]


SHEET = (
    "SELECT * FROM (VALUES "
    "('Sales report 2026', NULL, NULL), ('Region', 'Q1', 'Q2'), ('North', '10', '12'), "
    "('South', '7', '9'), ('Total', '17', '21')"
    ") AS t(column0, column1, column2)"
)


def test_messy_sheet_header_rows_and_bottom_rows():
    rows = run([
        {"header_rows": {"skip": 1, "rows": 1, "names": {"column0": "Region", "column1": "Q1", "column2": "Q2"}}},
        {"remove_rows": {"bottom": 1}},
    ], source=SHEET)
    assert rows == [{"Region": "North", "Q1": "10", "Q2": "12"}, {"Region": "South", "Q1": "7", "Q2": "9"}]
    rows = run([{"remove_rows": {"top": 2}}], source=SHEET)
    assert rows[0]["column0"] == "North" and len(rows) == 3


def test_expand_rows_json_and_delimited_and_several_columns():
    src = ("SELECT * FROM (VALUES (1, '[\"a\",\"b\"]', 'x;y'), (2, '[\"c\"]', 'z')) AS t(id, tags, codes)")
    rows = run([{"explode": {"columns": ["tags"]}}], source=src)
    assert [(r["id"], r["tags"]) for r in rows] == [(1, "a"), (1, "b"), (2, "c")]
    rows = run([{"explode": {"column": "codes", "json": False, "delimiter": ";"}}], source=src)
    assert [r["codes"] for r in rows] == ["x", "y", "z"]
    rows = run([{"split": {"column": "codes", "mode": "rows", "delimiter": ";"}}], source=src)
    assert [r["codes"] for r in rows] == ["x", "y", "z"]


def test_old_explode_steps_still_run():
    src = "SELECT * FROM (VALUES (1, '[1,2]')) AS t(id, xs)"
    assert len(run([{"explode": {"column": "xs"}}], source=src)) == 2


def test_join_on_similar_text_keeps_the_best_match():
    con = connect()
    con.execute("CREATE TABLE crm AS SELECT * FROM (VALUES ('ACME Limited', 'Gold'), ('Bolt Corp', 'Silver')) AS t(company, tier)")
    src = "SELECT * FROM (VALUES ('Acme Ltd', 10), ('bolt corp ', 5), ('Zeta', 1)) AS t(name, orders)"
    result = preview_steps([{"join": {"asset": "crm", "on": {"name": "company"}, "match": "similar", "threshold": 0.8}}],
                           source_sql=src, connection=con)
    assert result["step_errors"] == [], result["step_errors"]
    tiers = {r["name"]: r["tier"] for r in result["rows"]}
    assert tiers == {"Acme Ltd": "Gold", "bolt corp ": "Silver", "Zeta": None}


def test_bad_settings_are_explained():
    from src.modules.prep.engine.steps import parse_step

    with pytest.raises(ValueError, match="needs the column that sets the order"):
        parse_step({"window": {"calc": "running_total", "column": "amount", "into": "r"}})
    with pytest.raises(ValueError, match="increasing order"):
        parse_step({"bin": {"column": "amount", "into": "b", "edges": [200, 100]}})
    with pytest.raises(ValueError, match="same name"):
        parse_step({"header_rows": {"rows": 1, "names": {"a": "x", "b": "x"}}})
