"""Tests for PII gate — delegates to existing pii_scrubber library."""

from __future__ import annotations

import pytest

from src.modules.data.services.pii_scrubber import pii_scrubber
from src.modules.ai.services.pii_gate import (
    moderate_llm_output,
    scrub_data_payload,
    scrub_messages_for_llm,
    scrub_prompt_text,
)


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
