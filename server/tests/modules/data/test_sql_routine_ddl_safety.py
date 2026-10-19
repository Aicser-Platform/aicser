from src.modules.data.services.multi_engine_query_service import check_sql_routine_ddl_safety


def test_create_procedure_allowed():
    assert check_sql_routine_ddl_safety(
        "CREATE OR REPLACE PROCEDURE refresh_features() LANGUAGE sql AS $$ SELECT 1 $$"
    ) is None


def test_call_allowed():
    assert check_sql_routine_ddl_safety("CALL refresh_features()") is None


def test_create_trigger_allowed():
    assert check_sql_routine_ddl_safety(
        "CREATE TRIGGER trg_audit AFTER INSERT ON orders FOR EACH ROW EXECUTE PROCEDURE audit_row()"
    ) is None


def test_insert_rejected():
    assert check_sql_routine_ddl_safety("INSERT INTO t VALUES (1)") is not None


def test_drop_table_rejected():
    assert check_sql_routine_ddl_safety("DROP TABLE users") is not None


def test_select_rejected():
    assert check_sql_routine_ddl_safety("SELECT 1") is not None
