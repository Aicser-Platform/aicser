"""Tests for agent kernel planner, verifier, and continuation."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.kernel.continuation import (
    budget_exhausted,
    build_continuation_message,
    get_budget_limits,
    load_plan_from_state,
    persist_continuation,
)
from ee.modules.ai.kernel.goal_resolver import is_multi_step_request, resolve_goal_heuristic, should_use_agent_kernel
from ee.modules.ai.kernel.nodes import _step_progress_label, agent_goal_planner_node
from ee.modules.ai.kernel.planner import build_plan
from ee.modules.ai.kernel.replanner import replan, should_replan
from ee.modules.ai.kernel.schemas import AgentGoal, AgentPlan, AgentPlanStep, DeliverableType, VerificationResult
from ee.modules.ai.kernel.verifier import verify_goal, verify_step


def test_should_use_agent_kernel_declines_a_plain_single_deliverable_query():
    """RELIABILITY: should_use_agent_kernel used to route every non-excluded
    request through the kernel's goal/plan/execute/verify(+semantic-verify)
    pass unconditionally, including a plain single-metric/single-chart
    lookup with no multi-step shape at all — three to four extra LLM
    round-trips wrapping the exact same underlying nl2sql/insight-synthesis
    call the classic pipeline makes directly. Reported live as a ~10s ->
    ~60s latency regression for exactly this class of query, plus
    semantic-verification-triggered regeneration cycles occasionally
    producing thinner insights/recommendations than the classic pipeline's
    single pass. Now declines unless is_multi_step_request() finds a
    concrete multi-step/multi-deliverable signal — see that function's own
    docstring for the exact signals."""
    state = {
        "query": "show revenue by month as a bar chart",
        "data_source_id": "ds-1",
        "agent_context": {"analysis_mode": "standard"},
    }
    assert should_use_agent_kernel(state) is False


def test_should_use_agent_kernel_still_routes_genuine_multi_step_requests():
    """The narrowing above must not throw out real multi-step requests —
    "end to end" matches _MULTI_STEP_RE, the same signal
    resolve_goal_heuristic already uses to size the deliverable_type once a
    request reaches the kernel."""
    state = {
        "query": "analyze end to end and create executive report",
        "data_source_id": "ds-1",
        "agent_context": {"analysis_mode": "auto"},
    }
    assert should_use_agent_kernel(state) is True


@pytest.mark.parametrize(
    "query",
    [
        "show total revenue by month",
        "what is the total loan amount",
        "why did churn increase last quarter",
        "forecast revenue for next 6 months",
        "what actions would reduce late payments",
    ],
)
def test_is_multi_step_request_false_for_plain_single_deliverable_queries(query):
    assert is_multi_step_request(query) is False


@pytest.mark.parametrize(
    "query",
    [
        "do a comprehensive end to end analysis of churn",
        "analyze step by step why revenue dropped",
        "give me the full analysis from start to finish",
        "build a dashboard and then export an executive report",
    ],
)
def test_is_multi_step_request_true_for_explicit_multi_step_language(query):
    assert is_multi_step_request(query) is True


def test_is_multi_step_request_true_for_dashboard_or_report_alone():
    """A dashboard is inherently multi-widget (its own deliverable contract
    requires min_widget_count=3) and a report is inherently multi-section —
    each counts on its own, same reasoning should_use_agent_kernel already
    applies unconditionally to an explicit analysis_mode=="executive_report"
    selection, just detected from query text here for the "standard"/"auto"
    mode case."""
    assert is_multi_step_request("build a kpi dashboard for sales") is True
    assert is_multi_step_request("write an executive briefing on sales") is True
    assert is_multi_step_request("build a dashboard and an executive briefing for sales") is True


def test_is_multi_step_request_export_alone_is_not_multi_step():
    """A plain export of the current view/chart is one action, not two —
    only export combined with a dashboard/report ask is a build-then-export
    sequence worth kernel planning."""
    assert is_multi_step_request("export this as a pdf") is False
    assert is_multi_step_request("export a dashboard as pdf") is True
    assert is_multi_step_request("download an executive report as pdf") is True


def test_is_multi_step_request_true_for_document_field_extraction():
    """extract_document_fields is a kernel-only capability with no
    classic-pipeline equivalent — must keep routing to the kernel regardless
    of how simple the request otherwise sounds."""
    assert is_multi_step_request("extract the key terms from this contract") is True
    assert is_multi_step_request("pull out the invoice amount and due date") is True
    # Verb without a document-type noun, or vice versa, isn't enough on its own.
    assert is_multi_step_request("summarize this") is False


def test_is_multi_step_request_false_for_empty_query():
    assert is_multi_step_request("") is False
    assert is_multi_step_request("   ") is False


@pytest.mark.parametrize(
    "mode",
    ["decision_intelligence", "dashboard", "business_journey"],
)
def test_should_use_agent_kernel_declines_modes_with_dedicated_pipelines(mode):
    """These three still have their own dedicated, better-tested handling
    elsewhere (decision_intelligence/dashboard via supervisor_node.py's
    lifecycle routing, business_journey has no kernel capability at all yet)
    that a generic kernel goal/plan/execute/verify pass doesn't replicate.
    diagnostic/predictive/prescriptive/animate used to be excluded here too,
    but the kernel-unification roadmap brought them to parity with the
    classic graph's engines - see test_dedicated_mode_shadowing.py's
    test_should_use_agent_kernel_routes_all_four_analytics_engine_modes for
    their (now True) coverage."""
    state = {
        "query": "some request",
        "data_source_id": "ds-1",
        "agent_context": {"analysis_mode": mode},
    }
    assert should_use_agent_kernel(state) is False

    # Also declines when the mode arrives via analytics_type instead of
    # analysis_mode - frontend_analytics_type's own multi-source fallback in
    # supervisor_node.py means either can carry the resolved value.
    state2 = {
        "query": "some request",
        "data_source_id": "ds-1",
        "agent_context": {"analytics_type": mode},
    }
    assert should_use_agent_kernel(state2) is False


def test_should_use_agent_kernel_declines_cube_backed_sources():
    """The kernel has no Cube.js-aware capability at all - only the classic
    graph's cube_query_node knows how to query a Cube-backed source, and it can
    only ever be selected by the LLM orchestrator, which never runs once the
    kernel claims the request first."""
    state = {
        "query": "what's total revenue this quarter",
        "data_source_id": "ds-1",
        "agent_context": {"analysis_mode": "auto"},
        "cube_schema": {"cubes": [{"name": "Revenue"}]},
    }
    assert should_use_agent_kernel(state) is False


@pytest.mark.parametrize(
    "query",
    [
        "give me a deep dive on this file",
        "do a deep analysis of this dataset",
        "profile this data for me",
        "I need an in-depth analysis of the uploaded spreadsheet",
    ],
)
def test_should_use_agent_kernel_declines_deep_file_analysis_intent(query):
    """deep_file_analysis_node does independent data profiling and LLM-generated
    Python analysis with no kernel-capability equivalent - same unreachability
    bug as Cube's, via the same never-runs LLM-orchestrator path."""
    state = {
        "query": query,
        "data_source_id": "ds-1",
        "agent_context": {"analysis_mode": "auto"},
    }
    assert should_use_agent_kernel(state) is False


def test_resolve_goal_dashboard():
    state = {
        "query": "Build a sales dashboard",
        "agent_context": {"analysis_mode": "dashboard"},
        "project_id": "p1",
    }
    goal = resolve_goal_heuristic(state)
    assert goal.deliverable_type == DeliverableType.dashboard
    assert goal.min_widget_count >= 3


@pytest.mark.asyncio
async def test_build_plan_dashboard():
    goal = AgentGoal(
        objective="Sales dashboard",
        deliverable_type=DeliverableType.dashboard,
    )
    plan = await build_plan(goal, {"dashboard_tier": "executive"}, litellm_service=None)
    assert len(plan.steps) == 1
    assert plan.steps[0].capability == "create_dashboard"


def test_verify_step_dashboard_failure():
    step = AgentPlanStep(id="d1", capability="create_dashboard", label="Build")
    step.status = "complete"
    state = {"dashboard_created": {"dashboard_id": "x", "widget_count": 1, "status": "partial"}}
    result = verify_step(step, state, {})
    assert result.passed is False
    assert any("widget" in i for i in result.issues)


def test_verify_goal_dashboard_contract():
    goal = AgentGoal(objective="Dash", deliverable_type=DeliverableType.dashboard, min_widget_count=3)
    state = {
        "dashboard_created": {"dashboard_id": "d1", "widget_count": 5, "status": "complete"},
        "message": "Dashboard ready with 5 widgets for your team.",
    }
    v = verify_goal(goal, state)
    assert v.passed is True


def test_replan_adds_heal_step():
    plan = AgentPlan(
        goal=AgentGoal(objective="x", deliverable_type=DeliverableType.dashboard),
        steps=[AgentPlanStep(id="s1", capability="create_dashboard", label="Create", status="failed")],
    )
    state: dict = {"replan_count": 0}
    verification = VerificationResult(passed=False, heal_action="dashboard_heal", issues=["few_widgets:1"])
    assert should_replan(state, verification)
    new_plan = replan(plan, state, verification)
    assert len(new_plan.steps) == 2
    assert new_plan.steps[-1].capability == "create_dashboard"


def test_continuation_persist_and_load():
    goal = AgentGoal(objective="Multi step", deliverable_type=DeliverableType.multi_step)
    plan = AgentPlan(
        goal=goal,
        steps=[
            AgentPlanStep(id="a", capability="analytics_pipeline", label="Analyze", status="complete"),
            AgentPlanStep(id="b", capability="create_dashboard", label="Dashboard", status="pending"),
        ],
        cursor=1,
    )
    state: dict = {}
    token = persist_continuation(state, plan)
    assert token
    assert state.get("needs_agent_continuation") is True
    loaded = load_plan_from_state(state)
    assert loaded is not None
    assert loaded.cursor == 1
    msg = build_continuation_message(loaded, token)
    assert "continue" in msg.lower() or "resume" in msg.lower()


def test_budget_exhausted():
    max_steps, _ = get_budget_limits()
    goal = AgentGoal(objective="x", deliverable_type=DeliverableType.chart_analysis)
    plan = AgentPlan(
        goal=goal,
        steps=[
            AgentPlanStep(id=f"s{i}", capability="run_sql", label=f"S{i}", status="complete")
            for i in range(max_steps + 2)
        ],
        cursor=max_steps + 2,
    )
    state = {"replan_count": 0}
    assert budget_exhausted(state, plan) is True


@pytest.mark.parametrize(
    "capability,expected_phrase",
    [
        ("run_sql", "Querying your data"),
        ("analyze_data", "Analyzing query results"),
        ("visualize_results", "Building your chart"),
        ("search_libraries", "Searching knowledge libraries"),
        ("extract_document_fields", "Extracting fields from your document"),
        ("generate_docx", "Exporting as Word document"),
    ]
)
def test_step_progress_label_uses_capability_phrase_not_raw_label(capability, expected_phrase):
    """agent_executor_node used to show f"Executing: {step.label}" verbatim as
    the live status line -- step.label is a short noun-phrase written for the
    plan checklist ("Analyze results", "Search knowledge libraries", "Export
    as DOCX"), not a live status update, and getSimpleMessage()
    (ThoughtProcessDisplay.tsx) has no friendly keyword mapping for several of
    these capabilities, so the raw "Executing: <label>" text leaked straight
    through to the user with no useful content -- the live bug reported as
    "Executing: Analyze results... nothing to help with waiting". Each
    capability's progress phrase must now be a real present-continuous status
    update, not the raw plan-step label."""
    step = AgentPlanStep(id="s1", capability=capability, label="Some Static Label")
    label = _step_progress_label(step)
    assert expected_phrase in label
    assert not label.startswith("Executing:")
    assert label != "Some Static Label"


def test_step_progress_label_falls_back_to_step_label_for_unknown_capability():
    """Org-defined custom workflow steps and LLM-decomposed adaptive plan
    steps (see _llm_decompose_steps in planner.py) can have arbitrary
    capability names this table doesn't know about -- must still return a
    real, non-empty status text (the step's own label) rather than blowing up
    or returning something empty/None."""
    step = AgentPlanStep(id="s1", capability="some_custom_org_capability", label="Custom step label")
    assert _step_progress_label(step) == "Custom step label"


def test_budget_not_exhausted_below_the_step_cap():
    max_steps, _ = get_budget_limits()
    goal = AgentGoal(objective="x", deliverable_type=DeliverableType.chart_analysis)
    plan = AgentPlan(
        goal=goal,
        steps=[
            AgentPlanStep(id=f"s{i}", capability="run_sql", label=f"S{i}", status="complete")
            for i in range(max_steps - 1)
        ],
        cursor=max_steps - 1,
    )
    state = {"replan_count": 0}
    assert budget_exhausted(state, plan) is False


@pytest.mark.asyncio
async def test_agent_goal_planner_node_narration_clear_survives_dict_update_merge():
    """RELIABILITY regression: agent_goal_planner_node used to clear stale
    pre-kernel narration/message via state.pop(key, None) -- which removes
    the key from THIS node's own returned dict, but the outer streaming loop
    folds each node's return value into a separate accumulator via a plain
    dict .update() call (langgraph_orchestrator.py's
    streaming_state.update(node_state)), which only ADDS/OVERWRITES keys
    present in node_state and never removes a key just because node_state
    lacks it. So the pop's clearing intent never reached the streamed
    accumulator: the classic supervisor's pre-kernel placeholder ("Next, I am
    planning execution.", set via advance_plan_step before handoff to the
    kernel) stayed live in the accumulator and kept streaming to the frontend
    as though the kernel had produced it -- reported live as a bare "Plan
    ready — executing…" line rendered as if it were the answer.

    Simulates exactly that merge: build a pre-populated accumulator (as if an
    earlier node had already streamed the placeholder), run the real node,
    then .update() the accumulator with the node's return value the same way
    the streaming loop does. An explicit `state["narration"] = ""` (present,
    empty) is what survives that merge; an absent key (from .pop) would not.
    """
    goal = AgentGoal(objective="Test goal", deliverable_type=DeliverableType.chart_analysis)
    plan = AgentPlan(goal=goal, steps=[AgentPlanStep(id="s1", capability="run_sql", label="Run SQL")])

    state: dict = {
        "query": "what is the total loan amount",
        "conversation_id": "conv-1",
        "narration": "Next, I am planning execution.",
        "message": "Next, I am planning execution.",
    }

    with patch("ee.modules.ai.kernel.nodes.resolve_goal", new=AsyncMock(return_value=goal)), patch(
        "ee.modules.ai.kernel.nodes.build_plan", new=AsyncMock(return_value=plan)
    ), patch("ee.modules.ai.kernel.nodes.emit_agent_goal", new=AsyncMock()), patch(
        "ee.modules.ai.services.journey_goal_service.persist_active_goal", new=AsyncMock()
    ):
        node_state = await agent_goal_planner_node(state)

    # The node's own returned dict must have the keys explicitly cleared...
    assert node_state.get("narration") == ""
    assert node_state.get("message") == ""

    # ...and that clearing must actually survive the same accumulation the
    # real streaming loop performs, which is the whole point of this test.
    streaming_state: dict = {
        "narration": "Next, I am planning execution.",
        "message": "Next, I am planning execution.",
    }
    streaming_state.update(node_state)
    assert streaming_state["narration"] == ""
    assert streaming_state["message"] == ""
