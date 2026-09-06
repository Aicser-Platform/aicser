"""Tests for PII gate — delegates to existing pii_scrubber library."""

from __future__ import annotations

import pytest

from src.modules.data.services.pii_scrubber import pii_scrubber
from ee.modules.ai.services.pii_gate import (
    moderate_llm_output,
    scrub_data_payload,
    scrub_messages_for_llm,
    scrub_prompt_text,
)


@pytest.fixture(autouse=True)
def _pii_gate_enabled(monkeypatch):
    """AISER_PII_GATE_ENABLED defaults to "false" (disruptive-by-default PII
    detection was scoped to opt-in) -- every test in this file is specifically
    about verifying scrubbing behavior, so the gate must be on for all of
    them, not just the ones someone remembered to patch individually."""
    monkeypatch.setenv("AISER_PII_GATE_ENABLED", "true")


def test_scrub_prompt_uses_pii_scrubber():
    email = "Contact user@example.com for details"
    direct = pii_scrubber.scrub_text(email)
    gated = scrub_prompt_text(email)
    assert gated == direct
    assert "user@example.com" not in gated


def test_scrub_messages_for_llm():
    messages = [{"role": "user", "content": "Email me at alice@test.org"}]
    out = scrub_messages_for_llm(messages)
    assert "alice@test.org" not in out[0]["content"]


def test_scrub_data_payload_rows():
    rows = [{"email": "bob@corp.com", "revenue": 100}]
    out = scrub_data_payload(rows, max_rows=5)
    assert out[0]["email"] != "bob@corp.com"


def test_moderate_llm_output_scrubs_pii_and_credentials():
    text = "User email is charlie@example.com and api_key=sk-abcdefghijklmnopqrstuvwxyz123456"
    out = moderate_llm_output(text)
    assert "charlie@example.com" not in out
    assert "sk-abcdefghijklmnopqrstuvwxyz123456" not in out


def test_scrub_insight_text_parity():
    raw = "Top customer john.doe@company.com spent $500"
    assert moderate_llm_output(raw) == pii_scrubber.scrub_insight_text(raw)


def test_moderate_llm_output_protects_dotted_schema_identifiers_when_opted_in():
    """moderate_llm_output (LLM OUTPUT, e.g. generated SQL) can now opt into
    the same "education.grades" -> "<URL>ades" ccTLD-false-positive guard
    that scrub_messages_for_llm (LLM INPUT) already had via
    auto_protect_identifiers -- see test_pii_gate_protected_terms.py's
    docstring for the original, input-side bug. Deliberately opt-in, not a
    default: see test_moderate_llm_output_defaults_still_scrub_real_pii."""
    text = "Generated SQL references education.grades and grades.student_id"
    out = moderate_llm_output(text, auto_protect_identifiers=True)
    assert "education.grades" in out
    assert "grades.student_id" in out
    assert "<URL>" not in out


def test_moderate_llm_output_defaults_still_scrub_real_pii():
    """Control: auto_protect_identifiers must default to off. Turning it on
    by default once weakened protection for every caller of this function
    (insights, executive summaries, chat replies) because a real email
    domain ("example.com") matches the same identifier-shape regex as a
    schema identifier -- caught here before it shipped further."""
    text = "Contact charlie@example.com about this."
    out = moderate_llm_output(text)
    assert "charlie@example.com" not in out
