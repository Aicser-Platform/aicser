from src.modules.data.services.multi_engine_query_service import check_sql_read_only_safety


def test_select_is_allowed():
    assert check_sql_read_only_safety("SELECT id FROM orders") is None
    assert check_sql_read_only_safety("  with cte as (select 1 as n) select n from cte") is None
    assert check_sql_read_only_safety("SELECT 1") is None


def test_union_is_allowed():
    assert check_sql_read_only_safety("SELECT 1 UNION ALL SELECT 2") is None


def test_set_as_alias_is_allowed():
    assert check_sql_read_only_safety('SELECT x AS "set" FROM t') is None


def test_dml_is_rejected():
    assert check_sql_read_only_safety("DELETE FROM orders") is not None
    assert check_sql_read_only_safety("INSERT INTO orders VALUES (1)") is not None
    assert check_sql_read_only_safety("UPDATE orders SET n = 1") is not None
    assert check_sql_read_only_safety("DROP TABLE orders") is not None


def test_stacked_statements_rejected():
    err = check_sql_read_only_safety("SELECT 1; DELETE FROM orders")
    assert err is not None


def test_copy_program_rejected():
    err = check_sql_read_only_safety("COPY orders TO PROGRAM 'rm -rf /'")
    assert err is not None


def test_explain_select_is_allowed():
    assert check_sql_read_only_safety("EXPLAIN SELECT id FROM orders") is None


def test_with_insert_is_rejected():
    err = check_sql_read_only_safety("WITH x AS (SELECT 1) INSERT INTO orders SELECT * FROM x")
    assert err is not None


def test_set_and_grant_statements_rejected():
    assert check_sql_read_only_safety("SET search_path TO public") is not None
    assert check_sql_read_only_safety("GRANT SELECT ON orders TO public") is not None
