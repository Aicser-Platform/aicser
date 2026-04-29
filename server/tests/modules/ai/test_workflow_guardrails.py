"""Tests for LangGraph workflow input guardrails."""

from src.modules.ai.utils.workflow_guardrails import (
    evaluate_workflow_input_guardrails,
    guardrail_user_message,
)


def test_guardrails_allow_normal_query():
    r = evaluate_workflow_input_guardrails(
        "Show total sales by month for 2024",
        user_id="u1",
        organization_id="o1",
    )
    assert r.allowed is True
    assert "Show total sales" in r.sanitized_query


def test_guardrails_block_empty():
    r = evaluate_workflow_input_guardrails("   ", user_id=None, organization_id=None)
    assert r.allowed is False
    assert r.block_reason == "empty_query"


def test_guardrails_strip_null_bytes():
    r = evaluate_workflow_input_guardrails("hello\x00world", user_id=None, organization_id=None)
    assert r.allowed is True
    assert "\x00" not in r.sanitized_query


def test_guardrail_user_message_keys():
    assert "shorten" in guardrail_user_message("query_too_long").lower()
