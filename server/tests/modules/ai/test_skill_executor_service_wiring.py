"""Regression test: agent-skill-routed queries (run_sql/create_chart/
create_dashboard, invoked via LLM function-calling or an explicit
`[Agent Skill: name]` marker) always failed to reach real data.

Root cause, found via the integration smoke suite
(tests/integration/test_mode_smoke.py::test_real_analytical_question_produces_real_data)
after fixing that suite's own event-loop bug: `skill_executor_wrapper` in
orchestrator/graph_builder.py called `skill_executor_node(state)` with no
services at all — every other node wrapper in that file passes
`orch.litellm_service`/`orch.data_service`/`orch.multi_query_service`, this
one uniquely didn't. skill_executor_node then built its `ctx` dict (passed
to skill_graph_handlers.py's skill_run_sql/skill_create_chart/
skill_create_dashboard) without those keys either, so every skill call ran
with litellm_service=None, data_service=None, multi_query_service=None —
and without ctx["data_source_schema"], the prefetched schema from state was
also silently dropped. nl2sql_node's one-off schema fallback fetch requires
data_service, so with it None the fetch was skipped with no error logged,
schema stayed empty, and nl2sql_node's fail-fast guard ("Refusing to call
LLM") fired on every single run_sql skill invocation.

A second, compounding bug: even had SQL generation succeeded, skill_run_sql's
result dict never included "query_result" (only "sql_query"), and
skill_executor_node's two carry-forward loops (ctx <- result, state <- ctx)
only copied ("sql_query", "echarts_config", "chart_type", "chart_title") —
so real query rows executed inside the skill would still never have reached
the top-level state the final SSE "complete" event is built from.

A third bug, in the same ctx-under-provisioning family, found by comparing
this skill path against nl2sql_node's own model/context resolution: even
after the services/schema fix above, ctx still never carried model_id,
agent_context, execution_metadata, or async_session_factory. nl2sql_node's
select_structured_model() reads state["execution_metadata"]["model_used"]
(populated at session start, in orchestrator/initial_state.py, alongside
model_id) to honor the user's explicit model choice, and multiple call
sites read agent_context["domain_template"]/["metadata"]["user_preferences"]
for domain-aware SQL. None of that reached nl2sql_node when routed through
skill_executor — the user's chosen model and org's onboarding profile were
silently ignored on every skill-routed query, even though the exact same
"explicit choice ignored" bug class had already been fixed at nine other
call sites earlier in this codebase's history (see
test_agent_context_model_id_bug.py). async_session_factory was similarly
dropped, degrading nl2sql_node's slower AgentExecutor fallback tier (which
needs it for its own DB work) whenever the fast path fails.
"""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.nodes.skill_executor_node import skill_executor_node


def _base_state(**overrides) -> dict:
    state = {
        "query": "what is the average score by grade letter",
        "user_id": "u1",
        "organization_id": None,
        "data_source_id": "ds-1",
        "data_source_schema": {"tables": [{"name": "grades", "columns": []}]},
        "data_source_db_type": "duckdb",
        "data_source_type": "database",
        "agent_plan": {
            "steps": [{"id": "run_sql", "type": "skill", "skill": "run_sql", "status": "pending"}],
            "planner_version": "1.0",
            "trigger": "test",
        },
    }
    state.update(overrides)
    return state


@pytest.mark.asyncio
async def test_skill_executor_wires_services_and_schema_into_ctx():
    captured_ctx = {}

    async def fake_run_skill(name, ctx):
        captured_ctx.update(ctx)
        return {"success": True, "skill": name, "sql_query": "SELECT 1", "query_result": [{"a": 1}], "row_count": 1}

    fake_litellm = object()
    fake_data_service = object()
    fake_multi_query = object()

    with patch("ee.modules.ai.skills.registry.run_skill", new=fake_run_skill), patch(
        "ee.modules.ai.skills.registry.load_org_skills_into_cache", new=AsyncMock()
    ):
        await skill_executor_node(
            _base_state(),
            litellm_service=fake_litellm,
            data_service=fake_data_service,
            multi_query_service=fake_multi_query,
        )

    assert captured_ctx.get("litellm_service") is fake_litellm
    assert captured_ctx.get("data_service") is fake_data_service
    assert captured_ctx.get("multi_query_service") is fake_multi_query
    assert captured_ctx.get("data_source_schema") == {"tables": [{"name": "grades", "columns": []}]}
    assert captured_ctx.get("data_source_db_type") == "duckdb"
    assert captured_ctx.get("data_source_type") == "database"


@pytest.mark.asyncio
async def test_skill_executor_wires_model_choice_and_context_into_ctx():
    captured_ctx = {}

    async def fake_run_skill(name, ctx):
        captured_ctx.update(ctx)
        return {"success": True, "skill": name, "sql_query": "SELECT 1", "query_result": [{"a": 1}], "row_count": 1}

    fake_session_factory = object()
    state = _base_state(
        model_id="byok_ollama_qwen",
        agent_context={"domain_template": "manufacturing", "metadata": {"user_preferences": {"industry": "manufacturing"}}},
        execution_metadata={"model_used": "byok_ollama_qwen", "model_tier": "reasoning"},
    )

    with patch("ee.modules.ai.skills.registry.run_skill", new=fake_run_skill), patch(
        "ee.modules.ai.skills.registry.load_org_skills_into_cache", new=AsyncMock()
    ):
        await skill_executor_node(
            state,
            litellm_service=AsyncMock(),
            data_service=AsyncMock(),
            multi_query_service=AsyncMock(),
            async_session_factory=fake_session_factory,
        )

    assert captured_ctx.get("model_id") == "byok_ollama_qwen"
    assert captured_ctx.get("agent_context", {}).get("domain_template") == "manufacturing"
    assert captured_ctx.get("execution_metadata", {}).get("model_used") == "byok_ollama_qwen"
    assert captured_ctx.get("async_session_factory") is fake_session_factory


@pytest.mark.asyncio
async def test_skill_executor_omits_agent_context_safely_when_state_has_none():
    """Control case: when the incoming state has no agent_context/
    execution_metadata at all (the common case for a fresh turn), ctx must
    carry real dicts, not None — several nl2sql_node call sites do
    state.get("agent_context", {}).get(...), which only falls back to {}
    when the *key* is absent, not when the value is an explicit None."""
    captured_ctx = {}

    async def fake_run_skill(name, ctx):
        captured_ctx.update(ctx)
        return {"success": True, "skill": name}

    with patch("ee.modules.ai.skills.registry.run_skill", new=fake_run_skill), patch(
        "ee.modules.ai.skills.registry.load_org_skills_into_cache", new=AsyncMock()
    ):
        await skill_executor_node(
            _base_state(),
            litellm_service=AsyncMock(),
            data_service=AsyncMock(),
            multi_query_service=AsyncMock(),
        )

    assert captured_ctx.get("model_id") is None
    assert captured_ctx.get("agent_context") is None or captured_ctx.get("agent_context") == {}


@pytest.mark.asyncio
async def test_skill_executor_propagates_query_result_to_top_level_state():
    async def fake_run_skill(name, ctx):
        return {"success": True, "skill": name, "sql_query": "SELECT 1", "query_result": [{"avg_score": 86.65}], "row_count": 1}

    with patch("ee.modules.ai.skills.registry.run_skill", new=fake_run_skill), patch(
        "ee.modules.ai.skills.registry.load_org_skills_into_cache", new=AsyncMock()
    ):
        out = await skill_executor_node(
            _base_state(),
            litellm_service=AsyncMock(),
            data_service=AsyncMock(),
            multi_query_service=AsyncMock(),
        )

    assert out.get("query_result") == [{"avg_score": 86.65}]
    assert out.get("sql_query") == "SELECT 1"


def test_graph_builder_passes_orchestrator_services_to_skill_executor():
    """Guards against regression: skill_executor_wrapper must pass the same
    orch.litellm_service/data_service/multi_query_service every other node
    wrapper in this file passes — this exact omission is the root cause
    this file exists to catch."""
    import pathlib
    import re

    path = pathlib.Path(__file__).resolve().parents[3] / "ee" / "modules" / "ai" / "orchestrator" / "graph_builder.py"
    text = path.read_text(encoding="utf-8")
    match = re.search(r"async def skill_executor_wrapper.*?workflow\.add_node\(\"skill_executor\"", text, re.DOTALL)
    assert match, "skill_executor_wrapper not found in graph_builder.py"
    block = match.group(0)
    assert "orch.litellm_service" in block
    assert "orch.data_service" in block
    assert "orch.multi_query_service" in block
