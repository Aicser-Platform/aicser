"""Quality checks: the SQL each one runs, what passes, and the dialect it is sent in."""

from datetime import datetime, timedelta, timezone

import pytest

duckdb = pytest.importorskip("duckdb")
pytest.importorskip("sqlglot")

from fastapi import HTTPException  # noqa: E402

from src.modules.catalog.quality_tests import check_sql, judge, translate, validate  # noqa: E402


@pytest.fixture
def conn():
    c = duckdb.connect()
    c.execute("CREATE TABLE loans (id INT, status VARCHAR, rate DOUBLE, email VARCHAR, updated TIMESTAMP)")
    c.execute("""INSERT INTO loans VALUES
        (1, 'open', 5.5, 'a@x.com', now() - INTERVAL 2 HOUR),
        (2, 'closed', 7.0, 'b@x.com', now() - INTERVAL 3 HOUR),
        (2, 'lost', 31.0, NULL, now() - INTERVAL 30 HOUR),
        (4, NULL, -1.0, 'not-an-email', NULL)""")
    return c


def _run(conn, check, column=None, **params):
    params = validate(check, column, params)
    cur = conn.execute(check_sql(check, "loans", column, params))
    row = dict(zip([d[0] for d in cur.description], cur.fetchone()))
    return judge(check, params, row)


def test_value_checks_count_the_rows_that_break_them(conn):
    assert _run(conn, "not_null", "email") == ("failed", {"bad": 1, "rows": 4, "bad_percent": 25.0})
    assert _run(conn, "not_null", "email", max_bad_percent=30)[0] == "passed"
    assert _run(conn, "unique", "id")[1]["bad"] == 1
    assert _run(conn, "accepted_values", "status", values=["open", "closed"])[1]["bad"] == 1  # null isn't counted
    assert _run(conn, "range", "rate", min=0, max=30)[1]["bad"] == 2
    assert _run(conn, "pattern", "email", regex=r"^[^@]+@[^@]+\.[a-z]+$")[1]["bad"] == 1


def test_table_checks(conn):
    assert _run(conn, "row_count", min=1, max=10)[0] == "passed"
    assert _run(conn, "row_count", min=5)[0] == "failed"
    assert _run(conn, "freshness", "updated", hours=6)[0] == "passed"
    assert _run(conn, "custom_sql", sql="SELECT * FROM loans WHERE rate < 0")[1] == {"bad": 1}


def test_freshness_fails_when_old_or_empty():
    old = datetime.now(timezone.utc) - timedelta(hours=50)
    assert judge("freshness", {"hours": 24}, {"latest": old, "total": 3})[0] == "failed"
    assert judge("freshness", {"hours": 24}, {"latest": None, "total": 0})[0] == "failed"


def test_custom_sql_only_reads():
    with pytest.raises(HTTPException):
        validate("custom_sql", None, {"sql": "DELETE FROM loans"})
    with pytest.raises(HTTPException):
        validate("custom_sql", None, {"sql": "SELECT 1; DROP TABLE loans"})
    with pytest.raises(HTTPException):
        validate("not_null", None, {})


def test_sent_in_the_sources_dialect():
    sql = translate(check_sql("pattern", "public.loans", "email", {"regex": "^a"}), "postgres")
    assert "~" in sql or "REGEXP" in sql.upper()
    assert '"public"."loans"' in sql


def test_suggestions_come_from_the_numbers():
    from src.modules.catalog.quality_tests import propose

    now = datetime(2026, 10, 29, tzinfo=timezone.utc)
    stats = {"id": {"non_null": 100, "distinct": 100}, "status": {"non_null": 100, "distinct": 3},
             "rate": {"non_null": 90, "distinct": 100}, "updated": {"non_null": 100, "distinct": 100}}
    types = {"id": "INTEGER", "status": "VARCHAR", "rate": "DOUBLE", "updated": "TIMESTAMP"}
    got = propose(100, stats, types, {"status": ["closed", "open", "lost"]}, ("updated", now - timedelta(hours=10)), now)
    pairs = {(g["check"], g["column"]) for g in got}
    assert ("unique", "id") in pairs and ("not_null", "id") in pairs
    assert ("unique", "rate") not in pairs and ("not_null", "rate") not in pairs  # floats; has empties
    assert ("unique", "updated") not in pairs  # timestamps repeat in real data
    assert ("accepted_values", "status") in pairs
    assert {"check": "row_count", "column": None, "params": {"min": 50}} in got
    assert {"check": "freshness", "column": "updated", "params": {"hours": 24}} in got
    # A one-off load (newest row months old) gets no freshness test; tiny tables get nothing.
    old = propose(100, stats, types, {}, ("updated", now - timedelta(days=200)), now)
    assert not any(g["check"] == "freshness" for g in old)
    assert propose(5, stats, types, {}, None, now) == []
