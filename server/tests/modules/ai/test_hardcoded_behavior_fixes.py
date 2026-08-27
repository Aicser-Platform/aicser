"""Four hardcoded-decision fixes: business journey phase routing, prescriptive
scenario volatility scaling, diagnostic dimension selection, and decision
intelligence engine dispatch — replacing regex/fixed-constant decisions with
LLM judgment or genuine statistics where a fixed rule previously stood in."""

import json

import pandas as pd
import pytest

from ee.modules.ai.nodes.business_journey_nodes import business_journey_router_node
from ee.modules.ai.nodes.analytics_node import _llm_rerank_diagnostic_dimensions, _llm_select_engines, _run_composite_with_predictive
from ee.modules.ai.utils.data_profiler import profile_dataframe
from ee.modules.ai.utils.diagnostic_engine import run_diagnostic
from ee.modules.ai.utils.prescriptive_engine import run_prescriptive


class FakeLiteLLM:
    def __init__(self, content: str, success: bool = True):
        self.content = content
        self.success = success
        self.calls: list = []

    async def generate_completion(self, **kwargs):
        self.calls.append(kwargs)
        return {"success": self.success, "content": self.content, "model_used": "mock"}


# ── Business journey phase routing ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_business_journey_trusts_already_set_phase():
    """supervisor_node's LLM orchestration call already decides the phase - the
    router must not discard it and recompute via regex."""
    state = {"query": "what's next", "business_journey_phase": "strategy"}
    out = await business_journey_router_node(state)
    assert out["business_journey_phase"] == "strategy"


@pytest.mark.asyncio
async def test_business_journey_falls_back_to_regex_when_unset():
    state = {"query": "build me a 90 day action plan", "business_journey_phase": None}
    out = await business_journey_router_node(state)
    assert out["business_journey_phase"] == "plan"


@pytest.mark.asyncio
async def test_business_journey_falls_back_to_regex_on_invalid_leftover_value():
    state = {"query": "set up alerts for revenue drops", "business_journey_phase": "garbage"}
    out = await business_journey_router_node(state)
    assert out["business_journey_phase"] == "monitor"


# ── Prescriptive scenario volatility scaling ────────────────────────────────


def test_prescriptive_scenarios_scale_to_volatility():
    df_low = pd.DataFrame({
        "revenue": [100.0, 101.0, 99.5, 100.5, 100.2, 99.8, 100.1, 100.3] * 3,
        "region": (["east", "west"] * 12),
        "marketing_spend": [10, 12, 9, 11, 10, 9, 11, 10] * 3,
    })
    profile_low = profile_dataframe(df_low)
    result_low = run_prescriptive(df_low, profile_low, "revenue", objective="maximize")
    pcts_low = {round(abs(list(s.assumptions.values())[0]), 4) for s in result_low.scenarios}
    assert pcts_low and max(pcts_low) <= 0.16

    df_high = pd.DataFrame({
        "revenue": [50.0, 500.0, 10.0, 800.0, 5.0, 900.0, 20.0, 700.0] * 3,
        "region": (["east", "west"] * 12),
        "marketing_spend": [10, 90, 5, 95, 8, 88, 12, 92] * 3,
    })
    profile_high = profile_dataframe(df_high)
    result_high = run_prescriptive(df_high, profile_high, "revenue", objective="maximize")
    pcts_high = {round(abs(list(s.assumptions.values())[0]), 4) for s in result_high.scenarios}
    assert pcts_high and max(pcts_high) >= 0.30

    # Risk bands stay correctly ordered for the non-default (low-volatility) scale
    smallest_pct = min(pcts_low)
    low_risk_scenarios = [s for s in result_low.scenarios if abs(list(s.assumptions.values())[0]) == smallest_pct]
    assert all(s.risk == "low" for s in low_risk_scenarios)


# ── Diagnostic dimension selection ──────────────────────────────────────────


def test_diagnostic_slices_multiple_dimensions_even_with_focus_dimension_set():
    """Previously: setting focus_dimension collapsed dims to that ONE column, so
    if the keyword match was wrong, no alternative was ever computed."""
    df = pd.DataFrame({
        "revenue": [100, 500, 120, 480, 110, 490, 130, 470] * 3,
        "region": (["east", "west"] * 12),
        "customer_tier": (["enterprise", "smb"] * 12),
        "channel": (["online", "retail"] * 12),
    })
    profile = profile_dataframe(df)
    result = run_diagnostic(df, profile, "revenue", focus_dimension="region")
    dims_sliced = {s.dimension for s in result.dimension_slicing}
    assert len(dims_sliced) >= 2


@pytest.mark.asyncio
async def test_diagnostic_llm_rerank_promotes_relevant_dimension_over_variance_order():
    slicing = [
        {"dimension": "region", "anomalous_segment": "east", "deviation_pct": 20.0, "zscore": 2.0, "contribution_to_total_variance": 0.5},
        {"dimension": "customer_tier", "anomalous_segment": "enterprise", "deviation_pct": 15.0, "zscore": 1.5, "contribution_to_total_variance": 0.3},
    ]
    llm = FakeLiteLLM(json.dumps({"preferred_dimensions": ["customer_tier"], "rationale": "user asked about enterprise customers"}))
    reranked = await _llm_rerank_diagnostic_dimensions(slicing, "why did our enterprise customers churn", llm)
    assert reranked[0]["dimension"] == "customer_tier"
    assert len(llm.calls) == 1


@pytest.mark.asyncio
async def test_diagnostic_llm_rerank_fails_open_on_llm_error():
    slicing = [
        {"dimension": "region", "contribution_to_total_variance": 0.5},
        {"dimension": "customer_tier", "contribution_to_total_variance": 0.3},
    ]
    llm_fail = FakeLiteLLM("", success=False)
    reranked = await _llm_rerank_diagnostic_dimensions(slicing, "why did revenue change", llm_fail)
    assert reranked == slicing


@pytest.mark.asyncio
async def test_diagnostic_llm_rerank_skips_call_with_single_dimension():
    slicing = [{"dimension": "region", "contribution_to_total_variance": 0.5}]
    llm = FakeLiteLLM(json.dumps({"preferred_dimensions": [], "rationale": ""}))
    reranked = await _llm_rerank_diagnostic_dimensions(slicing, "why did revenue change", llm)
    assert llm.calls == []
    assert reranked == slicing


# ── Decision intelligence engine dispatch ───────────────────────────────────


@pytest.mark.asyncio
async def test_engine_selection_respects_llm_choice():
    llm = FakeLiteLLM(json.dumps({"needs_diagnostic": False, "needs_predictive": True, "needs_prescriptive": False}))
    selection = await _llm_select_engines("forecast Q4 revenue", llm)
    assert selection == {"needs_diagnostic": False, "needs_predictive": True, "needs_prescriptive": False}


@pytest.mark.asyncio
async def test_engine_selection_fails_open_to_running_everything():
    llm_fail = FakeLiteLLM("", success=False)
    selection = await _llm_select_engines("forecast Q4 revenue", llm_fail)
    assert selection == {"needs_diagnostic": True, "needs_predictive": True, "needs_prescriptive": True}


@pytest.mark.asyncio
async def test_engine_selection_overrides_pathological_all_false():
    llm = FakeLiteLLM(json.dumps({"needs_diagnostic": False, "needs_predictive": False, "needs_prescriptive": False}))
    selection = await _llm_select_engines("something ambiguous", llm)
    assert selection == {"needs_diagnostic": True, "needs_predictive": True, "needs_prescriptive": True}


def test_composite_engine_dispatch_skips_disabled_engines():
    df = pd.DataFrame({
        "revenue": [100.0, 110.0, 105.0, 120.0, 130.0, 125.0, 140.0, 150.0] * 3,
        "month": list(range(1, 25)),
        "region": (["east", "west"] * 12),
    })
    profile = profile_dataframe(df)
    out = _run_composite_with_predictive(
        df, profile, "revenue", focus_dimension=None, objective="maximize",
        mode_params={}, want_diagnostic=False, want_predictive=False, want_prescriptive=True,
    )
    assert "diagnostic" not in out
    assert out.get("diagnostic_skipped") is True
    assert "prescriptive" in out


def test_composite_engine_dispatch_unchanged_when_all_wanted():
    df = pd.DataFrame({
        "revenue": [100.0, 110.0, 105.0, 120.0, 130.0, 125.0, 140.0, 150.0] * 3,
        "month": list(range(1, 25)),
        "region": (["east", "west"] * 12),
    })
    profile = profile_dataframe(df)
    out = _run_composite_with_predictive(df, profile, "revenue", focus_dimension=None, objective="maximize", mode_params={})
    assert "diagnostic" in out
    assert "prescriptive" in out
    assert "diagnostic_skipped" not in out
    assert "prescriptive_skipped" not in out
