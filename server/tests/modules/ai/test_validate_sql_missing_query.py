"""Missing SQL after NL2SQL must not become a user-facing 'validate' error."""

import pytest

from ee.modules.ai.nodes.validation_node import validate_sql_node
from ee.modules.ai.schemas.graph_state import should_fail_fast
from ee.modules.ai.utils.fail_fast import escalate_to_critical_failure


@pytest.mark.asyncio
async def test_validate_sql_does_not_clobber_llm_down_error():
    state = {
        "query": "how many customers are there",
        "sql_query": None,
        "error": "I'm temporarily unable to reach the AI service.",
        "error_code": "LLM_SERVICE_UNAVAILABLE",
        "critical_failure": True,
        "llm_service_down": True,
    }
    out = await validate_sql_node(state)
    assert "validate yet" not in str(out.get("error") or "").lower()
    assert "unable to reach the AI service" in str(out.get("error") or "")


@pytest.mark.asyncio
async def test_validate_sql_empty_does_not_invent_pipeline_jargon():
    state = {"query": "how many customers", "sql_query": ""}
    out = await validate_sql_node(state)
    assert (out.get("error") or "") != "No SQL query to validate yet"


def test_fail_fast_skips_validation_route():
    state = {}
    escalate_to_critical_failure(state, reason="NL2SQL: LLM service unrecoverable")
    assert should_fail_fast(state) is True
    assert "validate yet" not in str(state.get("error") or "").lower()
