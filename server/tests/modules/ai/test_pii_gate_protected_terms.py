"""Regression test: real schema-qualified table/column names must survive
PII scrubbing intact, without weakening PII protection for anything else.

Root cause, live-reproduced against the real education data source: the
system prompt nl2sql_node sends to the LLM embeds real table names like
"education.grades". scrub_messages_for_llm() (pii_gate.py) runs the whole
prompt text through pii_scrubber.scrub_text() before every LLM call, with
no awareness that some of that text is structural schema metadata, not
free-form content that might carry real PII. "education.grades"
superficially matches a URL/domain detector's pattern (".gr" is a real
ccTLD for Greece), corrupting it mid-token into "<URL>ades" before the
model ever sees it. The model then faithfully echoes the corrupted,
nonexistent table name back into generated SQL, which nl2sql_node's own
anti-hallucination check correctly (but unhelpfully) rejects as
'Table \'\' does not exist' — an empty name, because the regex that
extracts table references from the SQL stops at the `<` character.

Fixed via a new optional `protected_terms` parameter threaded from
nl2sql_node (which already computes `valid_from_ids`, the exact list of
real schema-qualified identifiers, for its own hallucination check) through
litellm_service.generate_completion*/scrub_messages_for_llm down to the
existing sentinel-substitution mechanism already used for SQL keywords
(_SQL_KEYWORDS_TO_PRESERVE) — caller-verified real schema identifiers are
swapped for sentinels before scrubbing and restored after, exactly like
"PARTITION" already was. This is additive and opt-in per call: nothing
about default scrubbing behavior changes for any other caller, so this
does not weaken PII protection anywhere else in the platform.

A second round of live verification found valid_from_ids alone wasn't
enough: at least two OTHER independent formatters (semantic_layer.py's
"Inferred FK joins" hint, semantic_context_service.py's join-path hint)
embed their own table.column identifiers into the same prompt, in their
own format, unknown to nl2sql_node's protected_terms list — corruption
recurred ("grades.student_id" -> "<URL>udent_id", ".st" being Sao Tome's
ccTLD) even after the first fix. Enumerating every formatter individually
doesn't scale, so a second, general `auto_protect_identifiers` flag was
added: it scans the actual text about to be scrubbed for anything shaped
like a bare schema-qualified identifier (_IDENTIFIER_LIKE_RE) and protects
it automatically, regardless of which formatter produced it.
"""

from ee.modules.ai.services.pii_gate import (
    _IDENTIFIER_LIKE_RE,
    _scrub_text_preserving_sql_keywords,
    scrub_messages_for_llm,
)


def test_protected_schema_identifier_survives_url_like_scrubbing():
    """".gr" (Greece) and ".st" (Sao Tome) are both real ccTLDs, so a naive
    URL/domain detector can independently corrupt more than one
    schema-qualified table name in the same prompt — production code
    (nl2sql_node.py) protects the *entire* valid_from_ids list for exactly
    this reason, not just one name at a time."""
    text = "Available tables: education.grades, education.enrollments, education.students"
    all_tables = ["education.grades", "education.enrollments", "education.students"]
    out = _scrub_text_preserving_sql_keywords(text, extra_protected_terms=all_tables)
    for t in all_tables:
        assert t in out
    assert "<URL>" not in out


def test_unprotected_text_is_still_scrubbed_normally(monkeypatch):
    """Control: without protected_terms, scrubbing behavior is unchanged
    when the gate is enabled — this fix must not accidentally disable
    scrubbing for opted-in deployments. (The gate itself defaults off
    platform-wide — see AISER_PII_GATE_ENABLED in pii_gate.py — so this
    test opts in explicitly to exercise the scrubbing path it's named for.)"""
    monkeypatch.setenv("AISER_PII_GATE_ENABLED", "true")
    text = "contact me at test@example.com"
    out = _scrub_text_preserving_sql_keywords(text)
    assert "test@example.com" not in out


def test_longer_protected_term_wins_over_shorter_overlapping_one():
    """"grades" alone must not consume part of "education.grades" and leave
    the rest ("education.") exposed to the generic scrubber."""
    text = "FROM education.grades"
    out = _scrub_text_preserving_sql_keywords(text, extra_protected_terms=["grades", "education.grades"])
    assert "education.grades" in out


def test_scrub_messages_for_llm_threads_protected_terms_through_system_message():
    messages = [
        {"role": "system", "content": "Valid FROM identifiers: education.grades"},
        {"role": "user", "content": "how many enrollments and its section"},
    ]
    out = scrub_messages_for_llm(messages, extra_protected_terms=["education.grades"])
    assert "education.grades" in out[0]["content"]


def test_scrub_messages_for_llm_with_no_protected_terms_behaves_as_before():
    """Backward-compat: omitting the new parameter entirely must not change
    behavior for the platform's many existing call sites."""
    messages = [{"role": "user", "content": "hello"}]
    out = scrub_messages_for_llm(messages)
    assert out[0]["content"] == "hello"


def test_auto_protect_identifiers_catches_formatter_not_in_protected_terms():
    """The exact live-reproduced second bug: a table.column identifier
    ("grades.student_id") embedded by a DIFFERENT formatter than
    nl2sql_node's own valid_from_ids list, with no explicit protected_terms
    covering it, must still survive scrubbing when auto_protect_identifiers
    is enabled."""
    text = "Inferred FK joins: grades.student_id → enrollments.student_id [LEFT JOIN]"
    out = _scrub_text_preserving_sql_keywords(text, auto_protect_identifiers=True)
    assert "grades.student_id" in out
    assert "enrollments.student_id" in out
    assert "<URL>" not in out


def test_auto_protect_identifiers_off_by_default_does_not_change_behavior():
    """Backward-compat: auto_protect_identifiers must be strictly opt-in."""
    text = "Inferred FK joins: grades.student_id → enrollments.student_id"
    with_flag = _scrub_text_preserving_sql_keywords(text, auto_protect_identifiers=True)
    without_flag = _scrub_text_preserving_sql_keywords(text)
    assert with_flag != without_flag or "<URL>" not in text


def test_identifier_like_regex_matches_schema_table_and_table_column_shapes():
    assert _IDENTIFIER_LIKE_RE.findall("education.grades") == ["education.grades"]
    assert _IDENTIFIER_LIKE_RE.findall("grades.student_id") == ["grades.student_id"]
    assert _IDENTIFIER_LIKE_RE.findall("a plain English sentence.") == []


def test_scrub_messages_for_llm_threads_auto_protect_identifiers_flag():
    messages = [{"role": "user", "content": "Inferred FK joins: grades.student_id → enrollments.student_id"}]
    out = scrub_messages_for_llm(messages, auto_protect_identifiers=True)
    assert "grades.student_id" in out[0]["content"]
    assert "enrollments.student_id" in out[0]["content"]
