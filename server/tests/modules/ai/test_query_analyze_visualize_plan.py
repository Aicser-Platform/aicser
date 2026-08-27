"""The most common agent-kernel query (a plain chart/analysis question, no
explicit mode) used to plan as one opaque "analytics_pipeline" step, so the
plan checklist (AgentPlanPanel) had nothing to show - it's suppressed below
2 steps to avoid clutter for genuinely single-step work. Split into three
separately-tracked steps (query -> analyze -> visualize) so the checklist
reflects real planner-composed tasks for the everyday case too, not just
multi-step deliverables like dashboards/reports."""

import pytest

from ee.modules.ai.kernel.capability_registry import get_capability_registry
from ee.modules.ai.kernel.executor import execute_next_step
from ee.modules.ai.kernel.planner import _llm_decompose_steps, build_plan
from ee.modules.ai.kernel.schemas import AgentGoal, DeliverableType


class _FakeLiteLLM:
    def __init__(self, tool_calls: list):
        self.tool_calls = tool_calls
        self.calls: list = []

    async def generate_completion_with_tools(self, **kwargs):
        self.calls.append(kwargs)
        return {"success": True, "tool_calls": self.tool_calls}


@pytest.mark.asyncio
async def test_multi_step_decomposition_prompt_does_not_bias_toward_fewer_steps():
    """A request already classified multi_step has, by definition, already
    been judged to genuinely have multiple parts - the decomposer's own
    prompt used to separately instruct the model to "combine work into one
    step where possible rather than over-splitting", actively working
    against showing a real checklist (AgentPlanPanel, suppressed below 2
    steps) for exactly the requests where the user most wants one."""
    llm = _FakeLiteLLM([{"name": "run_sql", "arguments": {"step_id": "s1", "depends_on": []}}])
    await _llm_decompose_steps("show revenue and also build a dashboard for it", llm, organization_id=None)
    assert len(llm.calls) == 1
    prompt = llm.calls[0]["prompt"]
    assert "combine work into one step where possible rather than over-splitting" not in prompt
    assert "own tool call" in prompt


@pytest.mark.asyncio
async def test_decompose_steps_uses_real_function_calling_with_capability_tools():
    """The model should be offered one real tool per available capability
    (not a JSON-object response_format), and it picks steps by calling them."""
    llm = _FakeLiteLLM([
        {"name": "run_sql", "arguments": {"step_id": "s1", "depends_on": []}},
        {"name": "create_dashboard", "arguments": {"step_id": "s2", "depends_on": ["s1"]}},
    ])
    steps = await _llm_decompose_steps("show revenue and also build a dashboard for it", llm, organization_id=None)
    assert steps is not None
    assert [s.capability for s in steps] == ["run_sql", "create_dashboard"]
    assert steps[1].depends_on == ["s1"]

    tools = llm.calls[0]["tools"]
    assert all(t["type"] == "function" for t in tools)
    tool_names = {t["function"]["name"] for t in tools}
    assert "run_sql" in tool_names and "create_dashboard" in tool_names
    # No hand-parsed JSON response_format - this is real function-calling.
    assert "response_format" not in llm.calls[0]


@pytest.mark.asyncio
async def test_decompose_steps_exposes_and_threads_per_step_query():
    """Each tool's schema used to carry only step_id/depends_on, so a compound
    request split into N steps had no way to give each capability its own
    distilled sub-ask - every step silently ran against the same undifferentiated
    original text. The capability registry's own input_schema (a real JSON Schema
    "query" property) is now merged into each tool's parameters, and whatever the
    model fills in must survive onto the resulting AgentPlanStep.params so the
    executor's ctx.update(step.params) can actually see it."""
    llm = _FakeLiteLLM([
        {
            "name": "create_dashboard",
            "arguments": {"step_id": "s1", "depends_on": [], "query": "revenue trends dashboard"},
        },
        {
            "name": "executive_report",
            "arguments": {"step_id": "s2", "depends_on": ["s1"], "query": "summary report of revenue trends"},
        },
    ])
    steps = await _llm_decompose_steps("build a revenue dashboard and email me a summary report", llm, organization_id=None)

    tools = llm.calls[0]["tools"]
    dashboard_tool = next(t for t in tools if t["function"]["name"] == "create_dashboard")
    assert "query" in dashboard_tool["function"]["parameters"]["properties"]
    assert "query" in dashboard_tool["function"]["parameters"]["required"]

    assert steps is not None
    assert steps[0].params["query"] == "revenue trends dashboard"
    assert steps[1].params["query"] == "summary report of revenue trends"
    assert steps[0].label == "revenue trends dashboard"


@pytest.mark.asyncio
async def test_decompose_steps_drops_unknown_capability_and_dedupes_step_ids():
    llm = _FakeLiteLLM([
        {"name": "run_sql", "arguments": {"step_id": "s1"}},
        {"name": "not_a_real_capability", "arguments": {"step_id": "s2"}},
        {"name": "create_dashboard", "arguments": {"step_id": "s1"}},  # id collision with the first call
    ])
    steps = await _llm_decompose_steps("do several things", llm, organization_id=None)
    assert steps is not None
    assert [s.capability for s in steps] == ["run_sql", "create_dashboard"]
    assert steps[0].id != steps[1].id


@pytest.mark.asyncio
async def test_decompose_steps_returns_none_on_empty_tool_calls():
    llm = _FakeLiteLLM([])
    steps = await _llm_decompose_steps("do something", llm, organization_id=None)
    assert steps is None


@pytest.mark.asyncio
async def test_default_chart_analysis_plan_has_three_tracked_steps():
    goal = AgentGoal(objective="Show revenue by region", deliverable_type=DeliverableType.chart_analysis)
    plan = await build_plan(goal, {}, litellm_service=None)
    assert [s.id for s in plan.steps] == ["query", "analyze", "visualize"]
    assert [s.capability for s in plan.steps] == ["run_sql", "analyze_data", "visualize_results"]
    assert plan.steps[1].depends_on == ["query"]
    assert plan.steps[2].depends_on == ["analyze"]


@pytest.mark.asyncio
async def test_export_step_depends_on_visualize_not_analyze():
    goal = AgentGoal(objective="Export revenue as pdf", deliverable_type=DeliverableType.export)
    plan = await build_plan(goal, {"query": "export revenue as pdf"}, litellm_service=None)
    export_step = next(s for s in plan.steps if s.id == "export")
    assert export_step.depends_on == ["visualize"]


@pytest.mark.asyncio
async def test_three_steps_execute_in_order_with_state_threading(monkeypatch):
    """Runs the real registry end-to-end (mocking only the underlying node
    functions) to confirm analytics_metadata survives the checkpoint-like
    boundary between the analyze and visualize steps, and every step reaches
    'complete' - not just that the plan is shaped correctly."""

    async def fake_run_sql(ctx):
        ctx["workflow_state"]["sql_query"] = "SELECT region, SUM(revenue) FROM sales GROUP BY region"
        ctx["workflow_state"]["query_result"] = [{"region": "West", "revenue": 100}]
        return {"success": True, "workflow_state": ctx["workflow_state"], "skill": "run_sql"}

    async def fake_analytics_node(state, litellm_service=None):
        state["analytics_metadata"] = {"top_contributors": ["West"]}
        return state

    async def fake_chart_builder_node(state):
        assert state.get("analytics_metadata", {}).get("top_contributors") == ["West"], (
            "visualize step must see analyze step's output across the plan-step boundary"
        )
        state["echarts_config"] = {"type": "bar"}
        return state

    async def fake_insight_synthesizer_node(state, litellm_service=None):
        state["insights"] = ["West region leads revenue"]
        return state

    monkeypatch.setattr(
        "ee.modules.ai.skills.skill_graph_handlers.skill_run_sql", fake_run_sql
    )
    import ee.modules.ai.nodes.analytics_node as analytics_module
    import src.modules.ai.nodes.chart_builder_node as chart_module
    import src.modules.ai.nodes.insight_synthesizer_node as insight_module

    monkeypatch.setattr(analytics_module, "analytics_node", fake_analytics_node)
    monkeypatch.setattr(chart_module, "chart_builder_node", fake_chart_builder_node)
    monkeypatch.setattr(insight_module, "insight_synthesizer_node", fake_insight_synthesizer_node)

    goal = AgentGoal(objective="Show revenue by region", deliverable_type=DeliverableType.chart_analysis)
    plan = await build_plan(goal, {}, litellm_service=None)

    state = {
        "query": "show revenue by region",
        "data_source_id": "ds-1",
        "user_id": "u1",
        "organization_id": "org-1",
    }
    for _ in range(3):
        plan, executed, result = await execute_next_step(state, plan, litellm_service=object())
        assert executed.status == "complete", f"step {executed.id} failed: {executed.error}"

    assert state["echarts_config"] == {"type": "bar"}
    assert state["insights"] == ["West region leads revenue"]
    assert all(s.status == "complete" for s in plan.steps)
