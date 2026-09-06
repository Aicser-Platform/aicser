"""Regression tests for two bugs found live via a real user query
("how many enrollments and its section") against the education data source:

1. The model generated `ORDER BY <LOCATION>` — a PII-scrubber redaction
   placeholder (see pii_scrubber.py's _classify_column, which maps
   address/street-like column names to the LOCATION entity type) echoed
   back as if it were a real column reference. DuckDB rejected it with a
   cryptic "syntax error at or near '<'". The existing
   sql_contains_pii_placeholder() guard (see test_sql_pii_placeholder_guard.py)
   was only ever wired into executive_report_execution_node's retry loop —
   the general chat/skill-executor path (query_execution_node, the shared
   choke point every SQL-executing caller goes through) had no such guard at
   all. Fixed by adding the same check to query_execution_node directly, so
   every caller gets it for free instead of needing its own copy.

2. Independently, skill_run_sql (skill_graph_handlers.py) reported
   success=True to the user ("Skill run_sql completed successfully") for
   this exact failed query, because its success condition was
   `bool(rows) or bool(state.get("sql_query"))` — since the SQL *string*
   survived the failed execution attempt, that alone was treated as
   sufficient for success, regardless of state["error"] being set by
   query_execution_node. skill_run_sql also never checked state["error"]
   after query_execution_node at all (only after nl2sql_node). Fixed by
   checking state["error"] after execution, and — since this skill path
   calls nl2sql_node/query_execution_node directly rather than through the
   main graph's execute_query(error) -> error_correction -> execute_query
   cycle — adding one bounded retry through the same error_correction_node
   the main graph uses, so a correctable error (like case #1) gets a real
   chance to self-correct instead of failing outright.
"""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.nodes.query_execution_node import query_execution_node
from ee.modules.ai.skills.skill_graph_handlers import _base_state, skill_run_sql


def _enrollments_schema():
    return {
        "tables": [
            {
                "name": "enrollments",
                "columns": [{"name": "section_id", "type": "VARCHAR"}, {"name": "student_id", "type": "VARCHAR"}],
            }
        ]
    }


@pytest.mark.asyncio
async def test_query_execution_node_refuses_sql_with_pii_placeholder():
    state = {
        "sql_query": "SELECT section_id, COUNT(*) AS enrollment_count FROM enrollments GROUP BY section_id ORDER BY <LOCATION> DESC LIMIT 200",
        "data_source_id": "ds-1",
        "data_source_schema": _enrollments_schema(),
        "query": "how many enrollments and its section",
    }

    out = await query_execution_node(state, multi_query_service=None, data_service=None)

    assert out.get("error")
    assert "placeholder" in out["error"].lower()
    assert out.get("correction_context", {}).get("issue") == "pii_placeholder_in_sql"
    # No rows should have been fabricated for a query that never ran.
    assert not out.get("query_result")


@pytest.mark.asyncio
async def test_query_execution_node_real_sql_unaffected_by_pii_guard():
    """Control case: a normal, no-placeholder query must not be blocked by
    this guard — only reach the (mocked) execution path."""
    state = {
        "sql_query": "SELECT section_id, COUNT(*) AS enrollment_count FROM enrollments GROUP BY section_id",
        "data_source_id": "ds-1",
        "data_source_schema": _enrollments_schema(),
        "query": "how many enrollments and its section",
    }
    fake_data_service = AsyncMock()
    fake_data_service.get_data_source_by_id = AsyncMock(return_value=None)

    out = await query_execution_node(state, multi_query_service=AsyncMock(), data_service=fake_data_service)

    # Doesn't assert success (no real DB here) — only that it did NOT take
    # the PII-placeholder short-circuit path.
    assert out.get("correction_context", {}).get("issue") != "pii_placeholder_in_sql"


@pytest.mark.asyncio
async def test_skill_run_sql_reports_failure_when_execution_errors():
    """The exact live bug: a failed query_execution_node run (state["error"]
    set, sql_query still present) must not be reported as success just
    because a SQL string exists."""

    async def fake_nl2sql_node(state, **kwargs):
        state["sql_query"] = "SELECT * FROM t ORDER BY <LOCATION>"
        return state

    async def fake_query_execution_node(state, **kwargs):
        state["error"] = "Parser Error: syntax error at or near \"<\""
        state["correction_context"] = {"error_type": "sql", "issue": "pii_placeholder_in_sql"}
        return state

    async def fake_error_correction_node(state, **kwargs):
        # Correction fails to find a fix (returns state unchanged, error stays set).
        return state

    with patch("ee.modules.ai.nodes.nl2sql_node.nl2sql_node", new=fake_nl2sql_node), patch(
        "ee.modules.ai.nodes.query_execution_node.query_execution_node", new=fake_query_execution_node
    ), patch("ee.modules.ai.nodes.error_correction_node.error_correction_node", new=fake_error_correction_node):
        result = await skill_run_sql(
            {
                "query": "how many enrollments and its section",
                "data_source_id": "ds-1",
                "litellm_service": AsyncMock(),
                "data_service": AsyncMock(),
                "multi_query_service": AsyncMock(),
            }
        )

    assert result["success"] is False
    assert result.get("error")


@pytest.mark.asyncio
async def test_skill_run_sql_retries_via_error_correction_and_succeeds():
    """When error_correction_node fixes the SQL, skill_run_sql must retry
    execution and report the eventual real success — not the first failure."""
    call_count = {"execute": 0}

    async def fake_nl2sql_node(state, **kwargs):
        state["sql_query"] = "SELECT * FROM t ORDER BY <LOCATION>"
        return state

    async def fake_query_execution_node(state, **kwargs):
        call_count["execute"] += 1
        if call_count["execute"] == 1:
            state["error"] = "Parser Error: syntax error at or near \"<\""
            state["correction_context"] = {"error_type": "sql", "issue": "pii_placeholder_in_sql"}
        else:
            state.pop("error", None)
            state["query_result"] = [{"section_id": "A", "enrollment_count": 12}]
        return state

    async def fake_error_correction_node(state, **kwargs):
        state["sql_query"] = "SELECT * FROM t ORDER BY section_id"
        state.pop("error", None)
        return state

    with patch("ee.modules.ai.nodes.nl2sql_node.nl2sql_node", new=fake_nl2sql_node), patch(
        "ee.modules.ai.nodes.query_execution_node.query_execution_node", new=fake_query_execution_node
    ), patch("ee.modules.ai.nodes.error_correction_node.error_correction_node", new=fake_error_correction_node):
        result = await skill_run_sql(
            {
                "query": "how many enrollments and its section",
                "data_source_id": "ds-1",
                "litellm_service": AsyncMock(),
                "data_service": AsyncMock(),
                "multi_query_service": AsyncMock(),
            }
        )

    assert result["success"] is True
    assert result["query_result"] == [{"section_id": "A", "enrollment_count": 12}]
    assert call_count["execute"] == 2


def test_base_state_defaults_agent_context_to_empty_dict_not_none():
    """A ctx without an explicit agent_context/execution_metadata (the
    common case: skill_executor_node.py's ctx carries state.get(...) as-is,
    which is None when state never had the key) must not leave state's
    value as a bare None — nl2sql_node.py:1804 does
    state.get("agent_context", {}).get("domain_template"), which only
    substitutes {} when the *key* is missing, not when the stored value is
    None; a bare None there would raise AttributeError."""
    state = _base_state({"query": "q", "data_source_id": "ds-1"})

    assert state["agent_context"] == {}
    assert state["execution_metadata"] == {}
    # The exact call pattern nl2sql_node.py uses at the vulnerable site.
    assert state.get("agent_context", {}).get("domain_template") is None


def test_base_state_preserves_real_agent_context_and_model_id():
    state = _base_state(
        {
            "query": "q",
            "data_source_id": "ds-1",
            "model_id": "byok_ollama_qwen",
            "agent_context": {"domain_template": "manufacturing"},
            "execution_metadata": {"model_used": "byok_ollama_qwen"},
        }
    )

    assert state["model_id"] == "byok_ollama_qwen"
    assert state["agent_context"]["domain_template"] == "manufacturing"
    assert state["execution_metadata"]["model_used"] == "byok_ollama_qwen"
