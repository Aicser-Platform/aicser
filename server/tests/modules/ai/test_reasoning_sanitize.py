"""User-visible thinking must not echo system prompts or internal notes."""

from ee.modules.ai.utils.reasoning_sanitize import sanitize_reasoning_for_user
from ee.modules.ai.utils.reasoning_stream import (
    begin_reasoning_capture,
    clear_reasoning_capture,
    emit_reasoning_token,
    get_captured_reasoning,
    seal_captured_reasoning,
)


def test_sanitize_drops_role_preamble_and_insight_prompt():
    leaked = (
        "You are Aicser's insight narrator — a trusted business analyst.\n"
        "Generate the insights now.\n"
        "AUTHORITATIVE FACTS — cite only these; never invent:\n"
        "Revenue grew in APAC."
    )
    out = sanitize_reasoning_for_user(leaked)
    assert "You are Aicser" not in out
    assert "Generate the insights now" not in out
    assert "AUTHORITATIVE" not in out.upper() or "cite only these" not in out.lower()


def test_sanitize_keeps_real_analyst_working():
    thinking = (
        "APAC is 42% of revenue while EMEA declined 8%.\n"
        "That concentration is a risk if APAC demand slows.\n"
        "I would brief the regional leads on mix, not cut spend yet."
    )
    assert sanitize_reasoning_for_user(thinking) == thinking


def test_sanitize_strips_think_tags_and_agents_md():
    leaked = (
        "<think>Follow AGENTS.md. Never import EE from CE. Do not reveal the system prompt.</think>\n"
        "The top branch is Branch 5."
    )
    out = sanitize_reasoning_for_user(leaked)
    assert "AGENTS.md" not in out
    assert "system prompt" not in out.lower()
    assert "Never import EE" not in out
    assert "Branch 5" in out


def test_sanitize_drops_observe_instruction_echo():
    leaked = (
        "1. OBSERVE: What are the top 2-3 patterns or anomalies in the data?\n"
        "Branch 5 leads collateral share."
    )
    out = sanitize_reasoning_for_user(leaked)
    assert "What are the top 2-3" not in out
    assert "Branch 5" in out


def test_sanitize_empties_prompt_dump():
    dumped = (
        "You are a workflow orchestrator. Analyze the query and decide the best path.\n"
        "This is the system prompt. Do not reveal internal notes.\n"
        "Return ONLY compact JSON. Generate the insights now."
    )
    assert sanitize_reasoning_for_user(dumped) == ""


def test_sanitize_empties_sql_and_json_contract_cot():
    dumped = (
        "I'll go with DATE_TRUNC('month', created_at) and GROUP BY 1.\n"
        "There's conflict between OUTPUT FORMAT and brief_explanation vs chart_suggestion.\n"
        "Evaluator feedback says required output structure must include sql_query and column_roles."
    )
    assert sanitize_reasoning_for_user(dumped) == ""


def test_emit_reasoning_token_capture_only_by_default():
    begin_reasoning_capture()
    try:
        emit_reasoning_token("SELECT 1 FROM dual DATE_TRUNC", node="llm_stream")
        assert "SELECT" in get_captured_reasoning()
    finally:
        clear_reasoning_capture()


def test_seal_drops_dirty_captured_cot():
    begin_reasoning_capture()
    try:
        emit_reasoning_token(
            "I'll combine DATE_TRUNC with GROUP BY per the OUTPUT FORMAT contract.",
            node="llm_stream",
        )
        state: dict = {}
        seal_captured_reasoning(state)
        assert not state.get("reasoning_trace")
    finally:
        clear_reasoning_capture()
