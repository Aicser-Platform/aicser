"""Regression tests for dashboard title/subtitle/key_insight honesty.

Root cause: when the dashboard LLM refinement call failed (provider error,
timeout, malformed JSON), plan_dashboard_with_llm silently fell back to the
deterministic heuristic seed (_heuristic_to_llm_seed) -- generic templated
text like "Focus on how revenue varies by region." -- but
DashboardLLMPlan.to_metadata() unconditionally reported
generated_by="ai_dashboard_llm_planner" regardless of whether the LLM ever
actually ran. There was no signal anywhere, including the final chat message
shown to the user, distinguishing a genuinely AI-crafted dashboard from a
generic fallback one wearing the same label. Reported live as "dashboard
title and executive summary [lack] variety" -- directly explained by this:
every failed-LLM dashboard got the same templated sentence, presented as if
it were a real insight.
"""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.schemas.dashboard_plan import DashboardLLMPlan


def _minimal_plan(**overrides) -> DashboardLLMPlan:
    data = {"dashboard_title": "Revenue Overview", "pages": []}
    data.update(overrides)
    return DashboardLLMPlan.model_validate(data)


def test_plan_defaults_to_used_llm_false():
    """The seed (heuristic fallback) never explicitly sets used_llm, so the
    field's own default must be honest about that -- False, not True."""
    plan = _minimal_plan()
    assert plan.used_llm is False


def test_to_metadata_reports_heuristic_fallback_when_llm_not_used():
    plan = _minimal_plan(used_llm=False)
    meta = plan.to_metadata()
    assert meta["generated_by"] == "heuristic_fallback"
    assert meta["used_llm"] is False


def test_to_metadata_reports_ai_planner_when_llm_succeeded():
    plan = _minimal_plan(used_llm=True)
    meta = plan.to_metadata()
    assert meta["generated_by"] == "ai_dashboard_llm_planner"
    assert meta["used_llm"] is True


@pytest.mark.asyncio
async def test_llm_refine_marks_used_llm_true_on_success():
    from ee.modules.ai.services.dashboard_llm_planner import _llm_refine_dashboard_plan

    seed = _minimal_plan()
    fake_result = {
        "success": True,
        "content": '{"dashboard_title": "Q3 Revenue Deep Dive", "pages": []}',
    }
    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion",
        new=AsyncMock(return_value=fake_result),
    ):
        refined = await _llm_refine_dashboard_plan(
            seed,
            prompt="show revenue trends",
            schema_summary="",
            data_source_name="",
            tables_info=[],
        )

    assert refined.used_llm is True
    assert refined.dashboard_title == "Q3 Revenue Deep Dive"


@pytest.mark.asyncio
async def test_llm_refine_falls_back_with_used_llm_false_on_provider_failure():
    """Reproduces the live scenario: the configured LLM provider is down
    (matches this session's real TokenHarbor/Azure outage) -- generate_completion
    returns success=False. The seed must come back with used_llm explicitly
    False, not silently inherit a stale True from anywhere."""
    from ee.modules.ai.services.dashboard_llm_planner import _llm_refine_dashboard_plan

    seed = _minimal_plan()
    fake_result = {"success": False, "content": ""}
    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion",
        new=AsyncMock(return_value=fake_result),
    ):
        result = await _llm_refine_dashboard_plan(
            seed,
            prompt="show revenue trends",
            schema_summary="",
            data_source_name="",
            tables_info=[],
        )

    assert result.used_llm is False
    assert result is seed


@pytest.mark.asyncio
async def test_llm_refine_falls_back_with_used_llm_false_on_exception():
    from ee.modules.ai.services.dashboard_llm_planner import _llm_refine_dashboard_plan

    seed = _minimal_plan()
    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion",
        new=AsyncMock(side_effect=RuntimeError("provider unreachable")),
    ):
        result = await _llm_refine_dashboard_plan(
            seed,
            prompt="show revenue trends",
            schema_summary="",
            data_source_name="",
            tables_info=[],
        )

    assert result.used_llm is False


@pytest.mark.asyncio
async def test_materializer_message_flags_degraded_dashboard_when_llm_failed():
    from ee.modules.ai.nodes.dashboard_pesd_nodes import dashboard_materializer_node

    state = {
        "data_source_id": "ds-1",
        "project_id": "proj-1",
        "user_id": "user-1",
        "query": "show revenue trends",
        "data_source_schema": {},
        "dashboard_widget_specs": [{"id": "w1"}],
        "dashboard_plan_meta": {},
        "dashboard_llm_plan_meta": {
            "key_insight": "Focus on how revenue varies by region.",
            "generated_by": "heuristic_fallback",
            "used_llm": False,
        },
        "agent_context": {},
    }
    fake_result = {
        "dashboard_id": "dash-1",
        "widget_count": 3,
        "failed_widgets": 0,
        "status": "complete",
        "dashboard_name": "Revenue Overview",
        "key_insight": "Focus on how revenue varies by region.",
        "widgets": [],
    }
    with patch(
        "ee.modules.ai.nodes.dashboard_pesd_nodes.create_dashboard_from_plan",
        new=AsyncMock(return_value=fake_result),
    ), patch(
        "ee.modules.ai.nodes.dashboard_pesd_nodes.emit_dashboard_widget_ready",
        new=AsyncMock(),
    ), patch("src.db.session.async_session"):
        out = await dashboard_materializer_node(state)

    assert "AI-refined insights weren't available" in out["message"]


@pytest.mark.asyncio
async def test_materializer_message_stays_clean_when_llm_succeeded():
    from ee.modules.ai.nodes.dashboard_pesd_nodes import dashboard_materializer_node

    state = {
        "data_source_id": "ds-1",
        "project_id": "proj-1",
        "user_id": "user-1",
        "query": "show revenue trends",
        "data_source_schema": {},
        "dashboard_widget_specs": [{"id": "w1"}],
        "dashboard_plan_meta": {},
        "dashboard_llm_plan_meta": {
            "key_insight": "Q3 revenue grew fastest in the EMEA region.",
            "generated_by": "ai_dashboard_llm_planner",
            "used_llm": True,
        },
        "agent_context": {},
    }
    fake_result = {
        "dashboard_id": "dash-1",
        "widget_count": 3,
        "failed_widgets": 0,
        "status": "complete",
        "dashboard_name": "Revenue Overview",
        "key_insight": "Q3 revenue grew fastest in the EMEA region.",
        "widgets": [],
    }
    with patch(
        "ee.modules.ai.nodes.dashboard_pesd_nodes.create_dashboard_from_plan",
        new=AsyncMock(return_value=fake_result),
    ), patch(
        "ee.modules.ai.nodes.dashboard_pesd_nodes.emit_dashboard_widget_ready",
        new=AsyncMock(),
    ), patch("src.db.session.async_session"):
        out = await dashboard_materializer_node(state)

    assert "AI-refined insights weren't available" not in out["message"]


@pytest.mark.asyncio
async def test_kpi_planner_unpacks_semantic_hints_tuple_without_crashing():
    """Regression: _load_semantic_hints returns (hint_text, certified_metrics)
    -- a 2-tuple -- but dashboard_kpi_planner_node used to hand that whole
    tuple to plan_dashboard_with_llm's `semantic_hints` param, which
    _llm_refine_dashboard_plan immediately calls .strip() on. AttributeError
    on every single dashboard build, silently swallowed by the node's own
    blanket `except Exception: logger.debug(...)`, so the LLM refinement
    pass (real schema + data-profile + certified-metrics + org-KPI grounding)
    never actually ran -- every dashboard silently fell back to the
    schema-safe-but-unenriched heuristic path. This asserts the fix: the
    string half reaches semantic_hints, the list half reaches
    certified_metrics, and neither crashes the node."""
    from ee.modules.ai.nodes.dashboard_pesd_nodes import dashboard_kpi_planner_node

    state = {
        "data_source_id": "ds-1",
        "data_source_db_type": "postgres",
        "data_source_schema": {"tables": [{"name": "orders", "columns": [{"name": "amount", "type": "numeric"}]}]},
        "dashboard_tier": "operational",
        "query": "show revenue trends",
        "project_id": "proj-1",
        "user_id": "user-1",
        "organization_id": "org-1",
    }
    fake_hints = ("Prefer the certified 'net_revenue' metric.", [{"name": "net_revenue", "certified": True}])
    fake_plan = _minimal_plan(used_llm=True)
    captured_kwargs: dict = {}

    async def _fake_plan_dashboard_with_llm(*_args, **kwargs):
        captured_kwargs.update(kwargs)
        return fake_plan, [
            {"name": "Net Revenue", "chart_type": "bar", "chart_query": {}, "layout": {}, "chart_options": {}}
            for _ in range(3)
        ]

    with patch(
        "ee.modules.ai.services.dashboard_generation_service._load_semantic_hints",
        new=AsyncMock(return_value=fake_hints),
    ), patch(
        "ee.modules.ai.nodes.dashboard_pesd_nodes._ensure_dashboard_data_model",
        new=AsyncMock(return_value=[]),
    ), patch(
        "ee.modules.ai.nodes.dashboard_pesd_nodes.build_kpi_sections",
        return_value=[],
    ), patch(
        "ee.modules.ai.services.dashboard_llm_planner.plan_dashboard_with_llm",
        new=AsyncMock(side_effect=_fake_plan_dashboard_with_llm),
    ), patch("src.db.session.async_session"):
        await dashboard_kpi_planner_node(state)

    # The node must not have swallowed an exception here (its own blanket
    # `except Exception: logger.debug(...)` around the LLM-planning block is
    # exactly what hid this bug) -- it should have reached
    # plan_dashboard_with_llm with the *unpacked* values, a string and a
    # list, never the raw 2-tuple.
    assert captured_kwargs.get("semantic_hints") == "Prefer the certified 'net_revenue' metric."
    assert captured_kwargs.get("certified_metrics") == [{"name": "net_revenue", "certified": True}]


@pytest.mark.asyncio
async def test_materializer_message_stays_clean_when_llm_planner_never_ran():
    """A missing dashboard_llm_plan_meta (LLM planner phase disabled/never
    attempted) must NOT be mistaken for a failure -- only an explicit
    used_llm=False triggers the honesty note."""
    from ee.modules.ai.nodes.dashboard_pesd_nodes import dashboard_materializer_node

    state = {
        "data_source_id": "ds-1",
        "project_id": "proj-1",
        "user_id": "user-1",
        "query": "show revenue trends",
        "data_source_schema": {},
        "dashboard_widget_specs": [{"id": "w1"}],
        "dashboard_plan_meta": {"key_insight": "Heuristic-only plan."},
        "agent_context": {},
    }
    fake_result = {
        "dashboard_id": "dash-1",
        "widget_count": 3,
        "failed_widgets": 0,
        "status": "complete",
        "dashboard_name": "Revenue Overview",
        "key_insight": "Heuristic-only plan.",
        "widgets": [],
    }
    with patch(
        "ee.modules.ai.nodes.dashboard_pesd_nodes.create_dashboard_from_plan",
        new=AsyncMock(return_value=fake_result),
    ), patch(
        "ee.modules.ai.nodes.dashboard_pesd_nodes.emit_dashboard_widget_ready",
        new=AsyncMock(),
    ), patch("src.db.session.async_session"):
        out = await dashboard_materializer_node(state)

    assert "AI-refined insights weren't available" not in out["message"]
