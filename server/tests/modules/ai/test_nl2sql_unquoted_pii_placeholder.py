"""Regression test: nl2sql_node's own hallucination-detection check missed
an UNQUOTED PII-placeholder-corrupted table reference.

Root cause, live-reproduced (third occurrence of the <URL>/<LOCATION>
placeholder-echo bug this session, after fixing it in query_execution_node.py
and executive_report_execution_node.py): the FROM/JOIN table-extraction
regex, `(?:FROM|JOIN)\\s+([a-zA-Z0-9_."`]+)`, has a character class that does
not include "<". For a QUOTED corrupted reference (FROM "<URL>ades"), the
regex still matches up to the opening quote, capturing an empty string after
quote-stripping — caught (if unhelpfully) as "Table '' not in schema". For
an UNQUOTED one (FROM <URL>ades, observed live via sql_dialect_translator.py
failing to parse it), the regex can't start matching at "<" at all — zero
capture, not even an empty one — so the corrupted reference is silently
never validated, and broken SQL proceeds all the way to a downstream
dialect-translation/execution failure instead of getting a clear,
retriable error at generation time.

Fixed by adding an explicit sql_contains_pii_placeholder() check (the same
shared, quote-agnostic regex already used in query_execution_node.py and
executive_report_execution_node.py) directly in nl2sql_node.py's structural
validation, positioned BEFORE the FROM/JOIN hallucination regex — not a
replacement for it, since the FROM/JOIN check also catches genuinely
hallucinated (non-placeholder) table names the PII check doesn't look for.
"""

import re

import pytest

from ee.modules.ai.utils.sql_cleaner import sql_contains_pii_placeholder


def _nl2sql_source() -> str:
    import pathlib

    path = (
        pathlib.Path(__file__).resolve().parents[3]
        / "ee"
        / "modules"
        / "ai"
        / "nodes"
        / "nl2sql_node.py"
    )
    return path.read_text(encoding="utf-8")


def test_unquoted_pii_placeholder_is_detected_by_the_shared_regex():
    """Confirms the actual live-reproduced gap: the FROM/JOIN regex's
    character class excludes "<", so it cannot even attempt to match an
    unquoted corrupted reference — sql_contains_pii_placeholder must catch
    it instead, since it scans the whole string with no such constraint."""
    sql = "SELECT grade_letter, AVG(score) AS avg_score FROM <URL>ades GROUP BY grade_letter"
    from_join_regex = re.compile(r'(?i)(?:FROM|JOIN)\s+([a-zA-Z0-9_."`]+)')

    assert from_join_regex.findall(sql) == [], "expected zero capture for the unquoted case — if this fails, the underlying regex changed"
    assert sql_contains_pii_placeholder(sql) is True


def test_nl2sql_node_checks_pii_placeholder_before_the_from_join_regex():
    """Source-scan guard: the new check must exist and run before the
    FROM/JOIN hallucination regex, positioned within the same structural
    validation block. A full _direct_sql_generation invocation isn't
    practical to unit test directly (~40 real dependencies — schema RAG,
    embedding scoring, few-shot retrieval); the real end-to-end behavior is
    covered by tests/integration/test_mode_smoke.py."""
    text = _nl2sql_source()
    pii_check_idx = text.find("if sql_contains_pii_placeholder(sql_query):")
    from_join_idx = text.find('(?:FROM|JOIN)\\s+([a-zA-Z0-9_."`]+)')

    assert pii_check_idx != -1, "sql_contains_pii_placeholder check not found in nl2sql_node.py"
    assert from_join_idx != -1, "FROM/JOIN hallucination regex not found in nl2sql_node.py"
    assert pii_check_idx < from_join_idx, "PII placeholder check must run before the FROM/JOIN regex"


@pytest.mark.asyncio
async def test_sql_contains_pii_placeholder_imported_in_nl2sql_node():
    """Guards against a regression where the check is written but the
    import is missing/removed, which would raise NameError only at runtime
    on the exact code path the corruption bug hits — not caught by a plain
    syntax check."""
    import ee.modules.ai.nodes.nl2sql_node as m

    assert hasattr(m, "sql_contains_pii_placeholder")
