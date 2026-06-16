"""Tests for LLM dashboard planner materialization (no live LLM)."""

import pytest

from src.modules.ai.schemas.dashboard_plan import (
    DashboardLLMPlan,
    DashboardPagePlan,
    DashboardWidgetLayout,
    DashboardWidgetPlan,
)
from src.modules.ai.services.dashboard_llm_planner import (
    materialize_dashboard_plan,
    _heuristic_to_llm_seed,
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
    from src.modules.ai.services import dashboard_llm_planner as planner_mod
    import src.modules.ai.services.litellm_service as litellm_mod

    calls: list = []

    class FakeLiteLLM:
        async def hydrate_user_byok_models(self, user_id):
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
    from src.modules.ai.services import dashboard_llm_planner as planner_mod

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
    from src.modules.ai.services import dashboard_llm_planner as planner_mod

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
