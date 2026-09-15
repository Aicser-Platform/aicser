"""Tests for LLM dashboard planner materialization (no live LLM)."""

import pytest

from ee.modules.ai.schemas.dashboard_plan import (
    DashboardLLMPlan,
    DashboardPagePlan,
    DashboardWidgetLayout,
    DashboardWidgetPlan,
)
from ee.modules.ai.services.dashboard_llm_planner import (
    materialize_dashboard_plan,
    _heuristic_to_llm_seed,
    _score_dashboard_candidate,
)

SALES_SCHEMA = {
    "tables": [
        {
            "name": "sales",
            "columns": [
                {"name": "order_date", "type": "timestamp"},
                {"name": "region", "type": "varchar"},
                {"name": "revenue", "type": "float"},
            ],
        }
    ]
}


def test_heuristic_seed_includes_text_headline_and_pages():
    seed = _heuristic_to_llm_seed(
        "Revenue dashboard by region with trends",
        SALES_SCHEMA,
        "sales",
    )
    assert seed.dashboard_title
    assert len(seed.pages) >= 1
    overview = seed.pages[0]
    assert overview.role == "overview"
    assert any(w.chart_type == "text" for w in overview.widgets)
    assert any(w.chart_type == "stat" for w in overview.widgets)


def test_materialize_adds_drill_through_target():
    plan = DashboardLLMPlan(
        dashboard_title="Sales Performance",
        dashboard_subtitle="Regional revenue drivers",
        key_insight="APAC leads growth.",
        story_arc="KPIs then trend then breakdown.",
        pages=[
            DashboardPagePlan(
                role="overview",
                name="Overview",
                widgets=[
                    DashboardWidgetPlan(
                        title="Revenue by Region",
                        chart_type="bar",
                        layout=DashboardWidgetLayout(x=0, y=4, w=8, h=5),
                        table_name="sales",
                        x="region",
                        y_metric="revenue",
                        aggregation="sum",
                        drill_through_to_details=True,
                    )
                ],
            ),
            DashboardPagePlan(
                role="details",
                name="Details",
                widgets=[
                    DashboardWidgetPlan(
                        title="Detail table",
                        chart_type="table",
                        layout=DashboardWidgetLayout(x=0, y=0, w=12, h=6),
                        table_name="sales",
                        x="region",
                        y_metric="revenue",
                    )
                ],
            ),
        ],
    )
    meta, widgets = materialize_dashboard_plan(plan, SALES_SCHEMA, detail_page_id="page-details-id")
    bar = next(w for w in widgets if w["chart_type"] == "bar")
    assert bar["chart_query"]["drillThrough"]["targetPageId"] == "page-details-id"
    assert bar["chart_query"]["drillThrough"]["filterField"] == "region"
    assert meta["key_insight"] == "APAC leads growth."


def test_materialize_text_widget_content():
    plan = DashboardLLMPlan(
        dashboard_title="Ops Dashboard",
        pages=[
            DashboardPagePlan(
                role="overview",
                name="Overview",
                widgets=[
                    DashboardWidgetPlan(
                        title="Headline",
                        chart_type="text",
                        layout=DashboardWidgetLayout(x=0, y=0, w=12, h=2),
                        text_content="Revenue accelerated in Q4 driven by enterprise deals.",
                    )
                ],
            )
        ],
    )
    _, widgets = materialize_dashboard_plan(plan, SALES_SCHEMA)
    text_w = widgets[0]
    assert text_w["chart_type"] == "text"
    assert "Q4" in text_w["chart_options"]["content"]


@pytest.mark.asyncio
async def test_llm_refine_hydrates_user_byok_before_completion(monkeypatch):
    """The planner must register the user's BYOK key on the LiteLLM service before
    generating. Otherwise a user-selected BYOK model (e.g. ``byok_google``) is
    reported "not configured" and silently falls back to the Azure default — which
    is exactly why a configured Gemini key was never used during generation.
    """
    from ee.modules.ai.services import dashboard_llm_planner as planner_mod
    # dashboard_llm_planner._llm_refine_dashboard_plan imports LiteLLMService via
    # the ee.modules.ai path internally, not src.modules.ai - patching the src
    # path leaves the real (network-calling) LiteLLMService in place, hanging
    # this test on a live LLM call instead of exercising the fake.
    import ee.modules.ai.services.litellm_service as litellm_mod

    calls: list = []

    class FakeLiteLLM:
        async def hydrate_user_byok_models(self, user_id, organization_id=None):
            calls.append(("hydrate", user_id))

        async def generate_completion(self, **kwargs):
            calls.append(("complete", kwargs.get("model_id")))
            return {"success": False, "content": ""}

    monkeypatch.setattr(litellm_mod, "LiteLLMService", FakeLiteLLM)

    seed = _heuristic_to_llm_seed("Revenue dashboard", SALES_SCHEMA, "sales")
    await planner_mod._llm_refine_dashboard_plan(
        seed,
        prompt="Revenue dashboard",
        schema_summary="",
        data_source_name="Sales DB",
        tables_info=[],
        model_id="byok_google",
        user_id="user-123",
    )

    assert ("hydrate", "user-123") in calls, "BYOK key was never hydrated for the user"
    # Hydration must happen BEFORE the completion call, or the BYOK model is unknown.
    assert calls.index(("hydrate", "user-123")) < calls.index(("complete", "byok_google"))


@pytest.mark.asyncio
async def test_plan_dashboard_with_llm_threads_user_id_to_refine(monkeypatch):
    """``user_id`` must flow from the public entrypoint into the refine step so the
    BYOK key can be hydrated for the right user."""
    from ee.modules.ai.services import dashboard_llm_planner as planner_mod

    seen: dict = {}

    async def _capture(seed, **kwargs):
        seen.update(kwargs)
        return seed

    monkeypatch.setattr(planner_mod, "_llm_refine_dashboard_plan", _capture)

    await planner_mod.plan_dashboard_with_llm(
        "Sales KPI dashboard",
        SALES_SCHEMA,
        data_source_name="Sales DB",
        use_llm=True,
        model_id="byok_google",
        user_id="user-123",
    )
    assert seen.get("user_id") == "user-123"


@pytest.mark.asyncio
async def test_plan_dashboard_with_llm_skips_live_call_when_disabled(monkeypatch):
    from ee.modules.ai.services import dashboard_llm_planner as planner_mod

    async def _fail_llm(*_a, **_k):
        raise RuntimeError("should not call LLM")

    monkeypatch.setattr(planner_mod, "_llm_refine_dashboard_plan", _fail_llm)

    plan, widgets = await planner_mod.plan_dashboard_with_llm(
        "Sales KPI dashboard",
        SALES_SCHEMA,
        data_source_name="Sales DB",
        use_llm=False,
    )
    assert plan.pages
    assert len(widgets) >= 3


def _widget(title: str, chart_type: str = "bar") -> DashboardWidgetPlan:
    return DashboardWidgetPlan(
        title=title, chart_type=chart_type, layout=DashboardWidgetLayout(x=0, y=0, w=6, h=4),
        table_name="sales", x="region", y_metric="revenue", aggregation="sum",
    )


def _plan(titles_and_types, key_insight="", used_llm=True) -> DashboardLLMPlan:
    widgets = [_widget(t, c) for t, c in titles_and_types]
    return DashboardLLMPlan(
        dashboard_title="Sales Overview", key_insight=key_insight,
        pages=[DashboardPagePlan(role="overview", name="Overview", widgets=widgets)],
        used_llm=used_llm,
    )


def test_score_prefers_more_chart_type_variety():
    monotone = _plan([("Revenue by Region", "bar"), ("Revenue by Product", "bar"), ("Revenue by Rep", "bar")])
    varied = _plan([("Revenue by Region", "bar"), ("Revenue Trend", "line"), ("Top Products", "table")])
    assert _score_dashboard_candidate(varied) > _score_dashboard_candidate(monotone)


def test_score_penalizes_near_duplicate_titles():
    # >=60% term overlap ("revenue","region" both present in the second title
    # too) -- same threshold dashboard_pesd_nodes.py's own dedup uses.
    clean = _plan([("Revenue by Region", "bar"), ("Orders by Channel", "line"), ("Top Customers", "table")])
    dupey = _plan([("Revenue by Region", "bar"), ("Revenue by Region Breakdown", "line"), ("Top Customers", "table")])
    assert _score_dashboard_candidate(clean) > _score_dashboard_candidate(dupey)


def test_score_rewards_a_real_key_insight_over_a_blank_one():
    with_insight = _plan(
        [("Revenue by Region", "bar")],
        key_insight="EMEA revenue grew 18% QoQ, outpacing every other region.",
    )
    without = _plan([("Revenue by Region", "bar")], key_insight="")
    assert _score_dashboard_candidate(with_insight) > _score_dashboard_candidate(without)


def test_score_rewards_widget_count_near_target():
    target = 6
    near_target = _plan([(f"Metric {i}", "bar") for i in range(6)])
    thin = _plan([("Revenue by Region", "bar")])
    assert _score_dashboard_candidate(near_target, target) > _score_dashboard_candidate(thin, target)


def test_score_handles_empty_plan_without_crashing():
    empty = DashboardLLMPlan(dashboard_title="Empty", pages=[])
    assert _score_dashboard_candidate(empty) == 0.0


@pytest.mark.asyncio
async def test_multi_candidate_disabled_by_default_calls_llm_once(monkeypatch):
    """The cost-conscious default: no env var set -> exactly one refine call,
    identical behavior to before this feature existed."""
    from ee.modules.ai.services import dashboard_llm_planner as planner_mod

    monkeypatch.setattr(planner_mod, "_MULTI_CANDIDATE_ENABLED", False)
    call_count = {"n": 0}

    async def _capture(seed, **_kwargs):
        call_count["n"] += 1
        seed.used_llm = True
        return seed

    monkeypatch.setattr(planner_mod, "_llm_refine_dashboard_plan", _capture)

    await planner_mod.plan_dashboard_with_llm(
        "Sales KPI dashboard", SALES_SCHEMA, data_source_name="Sales DB", use_llm=True,
    )
    assert call_count["n"] == 1


@pytest.mark.asyncio
async def test_multi_candidate_enabled_picks_the_higher_scoring_plan(monkeypatch):
    from ee.modules.ai.services import dashboard_llm_planner as planner_mod

    monkeypatch.setattr(planner_mod, "_MULTI_CANDIDATE_ENABLED", True)
    weak = _plan([("Revenue by Region", "bar"), ("Regional Revenue Breakdown", "line")])
    strong = _plan(
        [("Revenue by Region", "bar"), ("Revenue Trend", "line"), ("Top Products", "table")],
        key_insight="EMEA revenue grew 18% QoQ, outpacing every other region this quarter.",
    )
    responses = [weak, strong]

    async def _capture(seed, **_kwargs):
        return responses.pop(0)

    monkeypatch.setattr(planner_mod, "_llm_refine_dashboard_plan", _capture)

    state: dict = {}
    plan, _widgets = await planner_mod.plan_dashboard_with_llm(
        "Sales KPI dashboard", SALES_SCHEMA, data_source_name="Sales DB", use_llm=True, state=state,
    )
    assert plan.dashboard_title == "Sales Overview"
    assert len(plan.pages[0].widgets) == 3  # kept `strong`, not `weak`
    checkpoints = state.get("reveal_checkpoints") or []
    assert any(c.get("id") == "dashboard_candidate_chosen" for c in checkpoints)


@pytest.mark.asyncio
async def test_multi_candidate_second_call_failure_keeps_first_candidate(monkeypatch):
    """Best-effort: if generating the second candidate errors, the first
    (already-successful) plan must still be returned, not lost."""
    from ee.modules.ai.services import dashboard_llm_planner as planner_mod

    monkeypatch.setattr(planner_mod, "_MULTI_CANDIDATE_ENABLED", True)
    first = _plan([("Revenue by Region", "bar"), ("Revenue Trend", "line")])
    calls = {"n": 0}

    async def _capture(seed, **_kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return first
        raise RuntimeError("provider timeout")

    monkeypatch.setattr(planner_mod, "_llm_refine_dashboard_plan", _capture)

    plan, _widgets = await planner_mod.plan_dashboard_with_llm(
        "Sales KPI dashboard", SALES_SCHEMA, data_source_name="Sales DB", use_llm=True,
    )
    assert plan is first
