"""Regression test for a live-blocking bug: every executive report section
failed with a Python NameError as soon as it reached SQL execution.

Root cause: _execute_section built a QueryIdentity (user_id/organization_id/
project_id, used for RBAC-scoped query execution and audit) by reading
`state.get(...)` — but _execute_section never received `state` as a
parameter at all, only the top-level executive_report_execution_node did.
This is pre-existing (confirmed via git diff: untouched by this session's
other executive-report fixes) and was masked whenever report planning
itself failed or fell back to a smaller deterministic plan via a different
code path — this session's report-planner timeout fix (see
test_report_narrative_timeout_and_model.py) let planning succeed with real
LLM-planned sections for the first time, which is what actually reaches
this line and surfaces the NameError. Live-reproduced: all 7 planned
sections failed with error="name 'state' is not defined", sql=None,
producing a report with zero content (artifact quality gate scored 0.00)
even though planning and per-section narrative generation were both
individually confirmed working in isolation.

Fixed by threading user_id/organization_id/project_id through as explicit
parameters (matching the model_id threading pattern used elsewhere this
session), sourced from state at the one place that actually has it
(executive_report_execution_node -> _execute_and_emit -> _execute_section).
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from ee.modules.ai.nodes.executive_report_execution_node import _execute_section


@pytest.mark.asyncio
async def test_execute_section_does_not_raise_nameerror_on_state():
    multi_query_service = MagicMock()
    multi_query_service.execute_query = AsyncMock(
        return_value={
            "success": True,
            "data": [{"grade_letter": "A", "score": 91.2}],
            "columns": ["grade_letter", "score"],
        }
    )

    section = {
        "id": "kpi_1",
        "type": "kpi",
        "title": "Average Score",
        "sql": "SELECT grade_letter, AVG(score) AS score FROM grades GROUP BY grade_letter",
        "chart_type": "bar",
    }

    import asyncio

    result = await _execute_section(
        section=section,
        data_source={"id": "ds-1", "type": "sample_duckdb"},
        multi_query_service=multi_query_service,
        narrative_max_tokens=400,
        data_source_name="Education",
        report_title="Student Performance Report",
        semaphore=asyncio.Semaphore(4),
        user_id="user-1",
        organization_id="org-1",
        project_id="proj-1",
    )

    assert result["error"] != "name 'state' is not defined"
    # The query must have actually been attempted with a real identity, not
    # short-circuited by the NameError before execution.
    multi_query_service.execute_query.assert_awaited()
    _, call_kwargs = multi_query_service.execute_query.call_args
    identity = call_kwargs.get("identity")
    assert identity is not None
    assert identity.user_id == "user-1"
    assert identity.organization_id == "org-1"
    assert identity.project_id == "proj-1"


@pytest.mark.asyncio
async def test_execute_section_with_no_user_id_skips_identity_cleanly():
    """Control case: no user_id (e.g. a system/background job) must not
    crash — identity is simply None, matching the original intent of the
    `if asker else None` guard."""
    import asyncio

    multi_query_service = MagicMock()
    multi_query_service.execute_query = AsyncMock(
        return_value={"success": True, "data": [], "columns": []}
    )

    section = {
        "id": "kpi_1",
        "type": "kpi",
        "title": "Average Score",
        "sql": "SELECT AVG(score) AS avg_score FROM grades",
    }

    result = await _execute_section(
        section=section,
        data_source={"id": "ds-1", "type": "sample_duckdb"},
        multi_query_service=multi_query_service,
        narrative_max_tokens=400,
        data_source_name="Education",
        report_title="Student Performance Report",
        semaphore=asyncio.Semaphore(4),
    )

    assert result["error"] != "name 'state' is not defined"
    _, call_kwargs = multi_query_service.execute_query.call_args
    assert call_kwargs.get("identity") is None
