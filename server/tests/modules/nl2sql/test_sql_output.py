import pytest

from src.modules.nl2sql.sql_output import (
    extract_sql_from_llm_output,
    sql_looks_truncated,
    validate_sql_basic,
)


def test_extract_sql_from_json():
    raw = '{"sql_query": "SELECT id FROM users LIMIT 10", "explanation": "ok"}'
    sql = extract_sql_from_llm_output(raw)
    assert "FROM users" in sql


def test_validate_rejects_drop():
    ok, err = validate_sql_basic("SELECT * FROM users; DROP TABLE users")
    assert not ok
    assert "dangerous" in (err or "").lower()


def test_truncation_detection():
    assert sql_looks_truncated("SELECT id")
    assert not sql_looks_truncated("SELECT id FROM users LIMIT 5")
