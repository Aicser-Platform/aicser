import duckdb
import pytest

from src.modules.data.services.multi_engine_query_service import check_sql_read_only_safety
from src.modules.prep.engine.compiler import compile_steps
from src.shared.sql_guard import lock_duckdb, reaches_outside

OUTSIDE = [
    "SELECT * FROM read_text('/etc/hostname')",
    "select content from READ_BLOB('/proc/self/environ')",
    'SELECT * FROM "read_text"(\'/etc/hostname\')',
    "SELECT * FROM main.read_csv('/etc/hostname')",
    "SELECT * FROM read_text /* hi */ ('/etc/hostname')",
    "SELECT * FROM read_text/*/**/*/('/etc/hostname')",
    "SELECT * FROM read_text --x\n('/etc/hostname')",
    "SELECT count(*) FROM glob('/*')",
    "WITH a AS (SELECT * FROM read_parquet('s3://b/x.parquet')) SELECT * FROM a",
    "SELECT * FROM query('SELECT * FROM read_'||'text(''/etc/hostname'')')",
    "SELECT * FROM '/etc/passwd'",
    'SELECT * FROM "s3://bucket/x.csv"',
    "SELECT * FROM t JOIN '/tmp/a.csv' b ON true",
    "SELECT * FROM duckdb_secrets()",
    "SELECT pg_read_file('/etc/passwd')",
]
INSIDE = [
    "SELECT status, count(*) FROM orders GROUP BY 1",
    "SELECT \"query\" FROM searches",
    "SELECT load, glob FROM server_stats",
    "SELECT * FROM \"my table\" WHERE path = '/home/a'",
    "SELECT read_count, query_text FROM logs",
    "SELECT 'see read_text docs' AS note FROM t WHERE a = 1",
]


@pytest.mark.parametrize("sql", OUTSIDE)
def test_sql_that_reaches_outside_is_refused(sql):
    assert reaches_outside(sql)
    assert check_sql_read_only_safety(sql)


@pytest.mark.parametrize("sql", INSIDE)
def test_ordinary_sql_passes(sql):
    assert not reaches_outside(sql)


def test_a_locked_connection_cant_read_files_or_be_unlocked():
    conn = duckdb.connect()
    conn.execute("CREATE TABLE t AS SELECT 1 AS a")
    lock_duckdb(conn)
    assert conn.execute("SELECT a FROM t").fetchone() == (1,)
    with pytest.raises(duckdb.Error):
        conn.execute("SELECT * FROM read_text('/etc/hostname')")
    with pytest.raises(duckdb.Error):
        conn.execute("SET enable_external_access = true")


def test_a_prep_step_cant_read_files_but_its_source_can():
    bad = [{"sql": {"query": "SELECT * FROM read_text('/etc/hostname')"}}]
    with pytest.raises(ValueError, match="step 0"):
        compile_steps(bad, source_sql="SELECT 1 AS a")
    assert compile_steps([], source_sql="SELECT * FROM read_parquet('/data/x.parquet')")
