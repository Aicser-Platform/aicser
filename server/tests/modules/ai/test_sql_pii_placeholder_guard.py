"""Regression test: generated SQL containing an echoed PII-redaction
placeholder token must be caught before it reaches the database, not
surfaced as a cryptic DuckDB parser error.

Root cause, live-reproduced in the same executive_report verification that
found the state-undefined NameError: pii_scrubber correctly redacts real
values in LLM prompt context (e.g. a sample row's student name) to a token
like <PERSON> before that context reaches the model — necessary, working as
designed. But a model occasionally echoes that literal placeholder back
into SQL it generates instead of a real column reference (observed:
"GROUP BY <PERSON>, s.\"full_name\""), which DuckDB rejects with
"syntax error at or near '<'" after burning all 3 correction retries on
the same broken pattern.

Fixed by detecting the <ENTITY_TYPE> shape directly in
ee/modules/ai/utils/sql_cleaner.py (the shared SQL validation module used
across NL2SQL, validation, error correction, and query execution) and
wiring it into the executive report section retry loop so it short-circuits
straight to LLM correction with a clear, actionable error message instead
of wasting a DB round-trip on SQL that can never succeed.
"""

from ee.modules.ai.utils.sql_cleaner import sql_contains_pii_placeholder


def test_detects_person_placeholder_in_group_by():
    sql = 'SELECT s."student_id" FROM students s GROUP BY <PERSON>, s."full_name"'
    assert sql_contains_pii_placeholder(sql) is True


def test_detects_other_entity_types():
    for token in ("<EMAIL>", "<PHONE_NUMBER>", "<DATE_OF_BIRTH>", "<LOCATION>"):
        assert sql_contains_pii_placeholder(f"SELECT {token} FROM t") is True, token


def test_real_sql_with_no_placeholder_is_unaffected():
    sql = 'SELECT s."student_id", AVG(g."score") FROM students s JOIN grades g ON s."student_id" = g."student_id" GROUP BY s."student_id"'
    assert sql_contains_pii_placeholder(sql) is False


def test_does_not_false_positive_on_sql_comparison_operators():
    """Guard against over-matching: a bare '<' in a WHERE clause (a
    genuinely common, valid SQL construct) must not trip this — only the
    specific <UPPERCASE_WORD> redaction-token shape should."""
    sql = 'SELECT * FROM grades WHERE score < 60 AND score > 10'
    assert sql_contains_pii_placeholder(sql) is False


def test_empty_or_none_sql_is_safe():
    assert sql_contains_pii_placeholder("") is False
    assert sql_contains_pii_placeholder(None) is False
